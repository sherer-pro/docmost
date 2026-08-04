import { Injectable, Logger } from '@nestjs/common';
import { AiRun, User } from '@docmost/db/types/entity.types';
import {
  AiToolDefinition,
  AiToolExecutionResult,
  AI_TOOL_RESULT_MAX_BYTES,
} from '../tools/ai-tool-registry.service';
import { AiMcpPolicyService } from './ai-mcp-policy.service';
import { AiMcpClientPoolService } from './ai-mcp-client-pool.service';
import { AiMcpTransportError } from './ai-mcp-pinned-fetch';
import { AiMcpPolicyError } from './ai-mcp.types';
import { AiMcpRunSnapshot } from './ai-mcp-snapshot.types';
import {
  buildAiMcpResultEnvelope,
  normalizeAiMcpCallResult,
} from './ai-mcp-result.util';
import { AiOperationalMetricsService } from '../services/ai-operational-metrics.service';
import {
  AI_MCP_IDLE_TIMEOUT_MS,
  AI_MCP_MAX_RUN_CONNECTIONS,
  AI_MCP_MAX_RUN_EXTERNAL_TOOLS,
  AI_MCP_TOTAL_TIMEOUT_MS,
} from './ai-mcp.constants';
import { AiMcpObservedOutcome } from '../services/ai-operational-metrics.service';
import { remapAiMcpArguments } from './ai-mcp-tool-schema.util';

/**
 * A tool definition that came from an external MCP server.
 *
 * `writeClass` is always `read_only`, so the merged agent tool list can never
 * contain an external write tool.
 */
export type AiMcpToolDefinition = AiToolDefinition & {
  toolSource: 'external_mcp';
  mcpServerId: string;
  mcpNamespace: string;
  mcpRemoteToolName: string;
  mcpConfigVersion: number;
};

export type AiMcpExecuteContext = {
  run: AiRun;
  user: User;
  snapshot: AiMcpRunSnapshot;
  isCancelled: () => Promise<boolean>;
};

@Injectable()
export class AiMcpToolCallService {
  private readonly logger = new Logger(AiMcpToolCallService.name);

  constructor(
    private readonly policy: AiMcpPolicyService,
    private readonly pool: AiMcpClientPoolService,
    private readonly metrics: AiOperationalMetricsService,
  ) {}

  /**
   * Projects the run snapshot into agent tool definitions.
   *
   * The description is the administrator-authored text and the schema is the
   * sanitized one, so nothing a remote server wrote reaches the model.
   */
  listSnapshotDefinitions(
    snapshot: AiMcpRunSnapshot | null,
  ): AiMcpToolDefinition[] {
    if (!snapshot) {
      return [];
    }

    const definitions: AiMcpToolDefinition[] = [];
    for (const connection of snapshot.connections.slice(
      0,
      AI_MCP_MAX_RUN_CONNECTIONS,
    )) {
      for (const tool of connection.tools) {
        if (definitions.length >= AI_MCP_MAX_RUN_EXTERNAL_TOOLS) {
          return definitions;
        }
        definitions.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          writeClass: 'read_only',
          exposures: ['agent'],
          toolSource: 'external_mcp',
          mcpServerId: connection.serverId,
          mcpNamespace: connection.namespace,
          mcpRemoteToolName: tool.remoteName,
          mcpConfigVersion: connection.configVersion,
        });
      }
    }
    return definitions;
  }

  /** Space-administrator hints, keyed by namespace, for the system preamble. */
  listInstructions(
    snapshot: AiMcpRunSnapshot | null,
  ): Array<{ namespace: string; instructions: string }> {
    if (!snapshot) {
      return [];
    }
    return snapshot.connections
      .filter((connection) => connection.instructions?.trim())
      .map((connection) => ({
        namespace: connection.namespace,
        instructions: connection.instructions!.trim(),
      }));
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: AiMcpExecuteContext,
  ): Promise<AiToolExecutionResult> {
    const startedAt = Date.now();
    // The snapshot is not authorization on its own: every gate is re-checked
    // against live policy here.
    const resolved = await this.policy.assertCallAllowed({
      snapshot: context.snapshot,
      toolName,
      workspaceId: context.run.workspaceId,
      spaceId: context.run.spaceId,
      userId: context.run.userId,
    });

    const lease = await this.pool.acquire({
      serverId: resolved.connection.serverId,
      workspaceId: context.run.workspaceId,
      expectedConfigVersion: resolved.connection.configVersion,
      expectedPolicyVersion: context.snapshot.workspacePolicyVersion,
    });
    let leaseSettled = false;
    let observed = false;
    let livePolicyError: AiMcpPolicyError | null = null;

    // A run cancellation must not wait out the remote total timeout.
    const cancelController = new AbortController();
    const cancelPoll = setInterval(() => {
      void context
        .isCancelled()
        .then((cancelled) => {
          if (cancelled) {
            cancelController.abort();
          }
        })
        .catch(() => undefined);
    }, 500);
    cancelPoll.unref?.();
    let policyCheckPending = false;
    const policyPoll = setInterval(() => {
      if (policyCheckPending || livePolicyError) {
        return;
      }
      policyCheckPending = true;
      void this.policy
        .assertCallAllowed({
          snapshot: context.snapshot,
          toolName,
          workspaceId: context.run.workspaceId,
          spaceId: context.run.spaceId,
          userId: context.run.userId,
        })
        .catch((error: unknown) => {
          livePolicyError =
            error instanceof AiMcpPolicyError
              ? error
              : new AiMcpPolicyError(
                  'agent_mcp_access_revoked',
                  'External MCP policy could not be re-verified',
                );
          cancelController.abort();
        })
        .finally(() => {
          policyCheckPending = false;
        });
    }, 500);
    policyPoll.unref?.();

    const discard = (reason: string): void => {
      if (!leaseSettled) {
        leaseSettled = true;
        lease.discard(reason);
      }
    };
    const release = (): void => {
      if (!leaseSettled) {
        leaseSettled = true;
        lease.release();
      }
    };
    const record = (
      outcome: AiMcpObservedOutcome,
      resultBytes: number,
    ): void => {
      if (!observed) {
        observed = true;
        this.observe(
          outcome,
          startedAt,
          lease.wireBytes(),
          resultBytes,
        );
      }
    };

    try {
      const remoteArgs = remapAiMcpArguments(
        args,
        resolved.tool.argumentNameMap ?? {},
      ) as Record<string, unknown>;
      const raw = await lease.callTool(resolved.tool.remoteName, remoteArgs, {
        idleTimeoutMs: AI_MCP_IDLE_TIMEOUT_MS,
        totalTimeoutMs: AI_MCP_TOTAL_TIMEOUT_MS,
        signal: cancelController.signal,
      });

      // Close the race between the periodic check and a fast response. A result
      // is not accepted after any live gate or policy version changed.
      await this.policy.assertCallAllowed({
        snapshot: context.snapshot,
        toolName,
        workspaceId: context.run.workspaceId,
        spaceId: context.run.spaceId,
        userId: context.run.userId,
      });

      const outcome = normalizeAiMcpCallResult(raw);
      if (outcome.status !== 'ok') {
        // A content type we cannot render safely is a transport-level failure,
        // and the connection is discarded rather than reused.
        discard(outcome.status);
        record(
          outcome.status === 'unsupported_content'
            ? 'unsupported_content'
            : 'protocol_error',
          0,
        );
        throw new AiMcpTransportError(
          'external_mcp_invalid_response',
          outcome.status === 'unsupported_content'
            ? 'External MCP returned an unsupported content type'
            : 'External MCP returned an unusable response',
        );
      }

      const envelope = buildAiMcpResultEnvelope({
        namespace: resolved.connection.namespace,
        remoteToolName: resolved.tool.remoteName,
        result: outcome.result,
        truncated: false,
      });
      const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
      if (bytes > AI_TOOL_RESULT_MAX_BYTES) {
        discard('oversize');
        record('oversize', bytes);
        throw new AiMcpTransportError(
          'external_mcp_result_limit',
          'External MCP result exceeds the per-result limit',
        );
      }

      release();
      record(outcome.result.isError ? 'remote_error' : 'ok', bytes);
      if (outcome.result.isError) {
        throw new AiMcpTransportError(
          'external_mcp_remote_error',
          'External MCP tool reported an application error',
        );
      }
      return { content: envelope };
    } catch (error) {
      const policyError = livePolicyError ??
        (error instanceof AiMcpPolicyError ? error : null);
      if (policyError) {
        discard('policy_revoked');
        record('policy_denied', 0);
        throw policyError;
      }
      if (error instanceof AiMcpTransportError) {
        discard('call_failed');
        record(this.classify(error, cancelController.signal.aborted), 0);
        throw error;
      }
      // Any timeout, abort, or protocol error must tear down the connection:
      // the SDK settles the pending request on abort, but only closing the
      // transport ends the underlying HTTP request and SSE stream.
      discard('call_failed');
      const outcome = this.classify(error, cancelController.signal.aborted);
      record(outcome, 0);
      throw new AiMcpTransportError(
        outcome === 'total_timeout' || outcome === 'idle_timeout'
          ? 'external_mcp_timeout'
          : 'external_mcp_unavailable',
        'External MCP tool call failed',
      );
    } finally {
      clearInterval(cancelPoll);
      clearInterval(policyPoll);
    }
  }

  private classify(
    error: unknown,
    cancelled: boolean,
  ): AiMcpObservedOutcome {
    if (error instanceof AiMcpPolicyError) {
      return 'policy_denied';
    }
    if (cancelled) {
      return 'abort';
    }
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('timed out') || message.includes('timeout')) {
      return 'total_timeout';
    }
    if (message.includes('abort')) {
      return 'abort';
    }
    return 'connect_error';
  }

  private observe(
    outcome: AiMcpObservedOutcome,
    startedAt: number,
    wireBytes: number,
    resultBytes: number,
  ): void {
    this.metrics.observeMcpCall(
      outcome,
      Date.now() - startedAt,
      wireBytes,
      resultBytes,
    );
  }
}
