import {
  AiExternalMcpApprovedTool,
  AiExternalMcpDiscoveredTool,
} from '@docmost/api-contract';
import {
  buildAiMcpToolName,
  fingerprintAiMcpTool,
  AiMcpArgumentNameMap,
  sanitizeAiMcpInputSchemaWithMapping,
} from './ai-mcp-tool-schema.util';
import { AiMcpDiscoveredRemoteTool } from './ai-mcp.types';
import { AiMcpTransportError } from './ai-mcp-pinned-fetch';

/**
 * What is persisted for a discovered tool.
 *
 * The remote title and description are recorded only as booleans. Storing the
 * prose would put remote-authored instructions into our data flow for no gain:
 * the administrator writes the model-facing description themselves.
 */
export type AiMcpStoredDiscoveredTool = {
  remoteName: string;
  toolName: string;
  slug: string;
  schemaFingerprint: string;
  /** Sanitized. Null when the schema could not be represented safely. */
  inputSchema: Record<string, unknown> | null;
  /** Kept server-side and never copied into a model tool definition. */
  argumentNameMap?: AiMcpArgumentNameMap | null;
  remoteTitlePresent: boolean;
  remoteDescriptionPresent: boolean;
  remoteAnnotations: {
    readOnlyHint: boolean | null;
    destructiveHint: boolean | null;
    idempotentHint: boolean | null;
    openWorldHint: boolean | null;
  } | null;
};

function readHint(
  annotations: Record<string, unknown> | null,
  key: string,
): boolean | null {
  const value = annotations?.[key];
  return typeof value === 'boolean' ? value : null;
}

export function storeDiscoveredTool(
  namespace: string,
  remote: AiMcpDiscoveredRemoteTool,
): AiMcpStoredDiscoveredTool {
  const sanitized = sanitizeAiMcpInputSchemaWithMapping(remote.inputSchema);
  const toolName = buildAiMcpToolName(namespace, remote.remoteName);

  return {
    remoteName: remote.remoteName,
    toolName,
    slug: toolName.split('__')[2] ?? '',
    // Fingerprint the sanitized schema: an approval covers what the model will
    // actually receive, not what the server happened to send around it.
    schemaFingerprint: fingerprintAiMcpTool(remote.remoteName, sanitized),
    inputSchema: sanitized?.inputSchema ?? null,
    argumentNameMap: sanitized?.argumentNameMap ?? null,
    remoteTitlePresent: Boolean(remote.title && remote.title.trim()),
    remoteDescriptionPresent: Boolean(
      remote.description && remote.description.trim(),
    ),
    remoteAnnotations: remote.annotations
      ? {
          readOnlyHint: readHint(remote.annotations, 'readOnlyHint'),
          destructiveHint: readHint(remote.annotations, 'destructiveHint'),
          idempotentHint: readHint(remote.annotations, 'idempotentHint'),
          openWorldHint: readHint(remote.annotations, 'openWorldHint'),
        }
      : null,
  };
}

/**
 * Deduplicates by remote name.
 *
 * A server that advertises the same tool twice would otherwise produce two
 * entries competing for one namespaced tool name.
 */
export function storeDiscoveredTools(
  namespace: string,
  remoteTools: AiMcpDiscoveredRemoteTool[],
): AiMcpStoredDiscoveredTool[] {
  const byRemoteName = new Map<string, AiMcpStoredDiscoveredTool>();
  for (const remote of remoteTools) {
    if (!byRemoteName.has(remote.remoteName)) {
      byRemoteName.set(remote.remoteName, storeDiscoveredTool(namespace, remote));
    }
  }
  const stored = [...byRemoteName.values()];
  const byToolName = new Map<string, string>();
  for (const tool of stored) {
    const owner = byToolName.get(tool.toolName);
    if (owner && owner !== tool.remoteName) {
      throw new AiMcpTransportError(
        'external_mcp_namespace_conflict',
        'External MCP tools cannot be assigned unique internal names',
      );
    }
    byToolName.set(tool.toolName, tool.remoteName);
  }
  return stored;
}

export type AiMcpStoredApprovedTool = {
  toolName: string;
  remoteName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  argumentNameMap?: AiMcpArgumentNameMap;
  schemaFingerprint: string;
  approvedAt: string;
  approvedByUserId: string | null;
};

export function toDiscoveredToolView(
  stored: AiMcpStoredDiscoveredTool,
  approved: AiMcpStoredApprovedTool | undefined,
): AiExternalMcpDiscoveredTool {
  const properties = stored.argumentNameMap?.properties ?? {};
  const required = Array.isArray(stored.inputSchema?.required)
    ? (stored.inputSchema.required as string[])
    : [];
  const requiredAliases = new Set(required);

  return {
    remoteName: stored.remoteName,
    toolName: stored.toolName,
    remoteTitlePresent: stored.remoteTitlePresent,
    remoteDescriptionPresent: stored.remoteDescriptionPresent,
    remoteAnnotations: stored.remoteAnnotations,
    inputSchemaSummary: stored.inputSchema
      ? {
          propertyNames: Object.values(properties).map((entry) => entry.remoteName),
          requiredNames: Object.entries(properties)
            .filter(([alias]) => requiredAliases.has(alias))
            .map(([, entry]) => entry.remoteName),
          truncated: false,
        }
      : null,
    // A schema that could not be sanitized makes the tool unapprovable rather
    // than approvable with an unchecked schema.
    approvable: stored.inputSchema !== null,
    approved: approved !== undefined,
    changedSinceApproval:
      approved !== undefined &&
      approved.schemaFingerprint !== stored.schemaFingerprint,
  };
}

export function toApprovedToolView(
  approved: AiMcpStoredApprovedTool,
  discovered: AiMcpStoredDiscoveredTool | undefined,
): AiExternalMcpApprovedTool {
  return {
    toolName: approved.toolName,
    remoteName: approved.remoteName,
    description: approved.description,
    writeClass: 'read_only',
    approvedAt: approved.approvedAt,
    approvedByUserId: approved.approvedByUserId,
    schemaFingerprint: approved.schemaFingerprint,
    // A tool that vanished from discovery, or whose schema moved, counts as
    // changed so the agent never offers a stale contract.
    changedSinceApproval:
      discovered === undefined ||
      discovered.schemaFingerprint !== approved.schemaFingerprint,
  };
}
