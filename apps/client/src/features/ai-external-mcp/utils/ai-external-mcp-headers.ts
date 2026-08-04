import type { UpdateAiExternalMcpServerRequest } from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";

export const AI_EXTERNAL_MCP_MAX_HEADERS = 20;
export const AI_EXTERNAL_MCP_MAX_HEADER_VALUE_LENGTH = 8 * 1024;

export type AiExternalMcpHeaderRow = {
  id: string;
  name: string;
  value: string;
};

/**
 * The three mutually exclusive intents for stored headers.
 *
 * Modelling them as a union makes the combination the server rejects
 * (`headers` together with `clearHeaders`) impossible to construct.
 */
export type AiExternalMcpHeaderDraft =
  | { mode: "keep" }
  | { mode: "replace"; rows: AiExternalMcpHeaderRow[] }
  | { mode: "clear" };

export type AiExternalMcpHeaderPayload = Pick<
  UpdateAiExternalMcpServerRequest,
  "headers" | "clearHeaders"
>;

export type AiExternalMcpHeaderValidation =
  | { status: "ok" }
  | { status: "invalid"; reason: string; rowId?: string };

export function validateAiExternalMcpHeaderRows(
  rows: AiExternalMcpHeaderRow[],
): AiExternalMcpHeaderValidation {
  const named = rows.filter((row) => row.name.trim().length > 0);

  if (named.length > AI_EXTERNAL_MCP_MAX_HEADERS) {
    return { status: "invalid", reason: "tooMany" };
  }

  const seen = new Set<string>();
  for (const row of named) {
    const name = row.name.trim().toLowerCase();
    if (seen.has(name)) {
      return { status: "invalid", reason: "duplicate", rowId: row.id };
    }
    seen.add(name);

    if (row.value.length > AI_EXTERNAL_MCP_MAX_HEADER_VALUE_LENGTH) {
      return { status: "invalid", reason: "valueTooLong", rowId: row.id };
    }
  }

  // A value typed with no name would be silently dropped, which is worse than
  // telling the administrator their credential is not going to be saved.
  const orphanValue = rows.find(
    (row) => row.name.trim().length === 0 && row.value.length > 0,
  );
  if (orphanValue) {
    return { status: "invalid", reason: "nameRequired", rowId: orphanValue.id };
  }

  return { status: "ok" };
}

/**
 * Produces exactly one of `{}`, `{ headers }`, or `{ clearHeaders: true }`.
 *
 * Never both keys: omitting `headers` is how the server is told to keep the
 * stored ciphertext, and sending both is rejected.
 */
export function buildAiExternalMcpHeaderPayload(
  draft: AiExternalMcpHeaderDraft,
): AiExternalMcpHeaderPayload {
  if (draft.mode === "keep") {
    return {};
  }

  if (draft.mode === "clear") {
    return { clearHeaders: true };
  }

  const headers: Record<string, string> = {};
  for (const row of draft.rows) {
    const name = row.name.trim();
    if (name.length === 0) {
      continue;
    }
    headers[name] = row.value;
  }

  // Replacing with nothing means the same thing as clearing, and the server
  // treats an empty map as "no headers".
  return { headers };
}

export function createAiExternalMcpHeaderRow(
  id: string,
): AiExternalMcpHeaderRow {
  return { id, name: "", value: "" };
}
