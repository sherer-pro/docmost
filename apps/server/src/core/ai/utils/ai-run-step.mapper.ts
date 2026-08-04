import { AiRunStep } from '@docmost/api-contract';
import { AiRunStep as AiRunStepEntity } from '@docmost/db/types/entity.types';
import { extractAiApprovalPreview } from '../../../common/helpers/prosemirror/ai-page-operation';
import { parseAiMcpToolName } from '../mcp/ai-mcp-tool-schema.util';

/**
 * Single projection from an `ai_run_steps` row to the client contract.
 *
 * Both the REST reader and the realtime emitter go through here so a new
 * contract field cannot be added to one path and forgotten on the other.
 */
export function toAiRunStepContract(row: AiRunStepEntity): AiRunStep {
  const toolSource = (row.toolSource ?? 'builtin') as AiRunStep['toolSource'];

  return {
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    modelStep: row.modelStep,
    callIndex: row.callIndex,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    writeClass: row.writeClass as AiRunStep['writeClass'],
    toolSource,
    // Derived from the namespaced tool name rather than stored twice, so the
    // namespace shown to a client always matches the name the model was given.
    toolNamespace:
      toolSource === 'external_mcp'
        ? (parseAiMcpToolName(row.toolName)?.namespace ?? null)
        : null,
    arguments: row.arguments as Record<string, unknown>,
    result: row.result,
    approvalPreview: extractAiApprovalPreview(row.result),
    status: row.status as AiRunStep['status'],
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    targetPageId: row.targetPageId,
    baseContentHash: row.baseContentHash,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
