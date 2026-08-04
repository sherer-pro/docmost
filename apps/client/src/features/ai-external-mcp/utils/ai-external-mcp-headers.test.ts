import { describe, expect, it } from "vitest";
import {
  AI_EXTERNAL_MCP_MAX_HEADER_VALUE_LENGTH,
  AI_EXTERNAL_MCP_MAX_HEADERS,
  buildAiExternalMcpHeaderPayload,
  createAiExternalMcpHeaderRow,
  validateAiExternalMcpHeaderRows,
  type AiExternalMcpHeaderDraft,
  type AiExternalMcpHeaderRow,
} from "@/features/ai-external-mcp/utils/ai-external-mcp-headers.ts";

function row(
  name: string,
  value: string,
  id = `${name}-${value}`,
): AiExternalMcpHeaderRow {
  return { id, name, value };
}

describe("buildAiExternalMcpHeaderPayload", () => {
  it("omits both keys when the stored headers should be kept", () => {
    const payload = buildAiExternalMcpHeaderPayload({ mode: "keep" });

    // Asserted by key presence, not by value: an explicit undefined would be
    // serialized and read by the server as an instruction.
    expect("headers" in payload).toBe(false);
    expect("clearHeaders" in payload).toBe(false);
  });

  it("sends only headers when replacing", () => {
    const payload = buildAiExternalMcpHeaderPayload({
      mode: "replace",
      rows: [row("Authorization", "Bearer token")],
    });

    expect(payload.headers).toEqual({ Authorization: "Bearer token" });
    expect("clearHeaders" in payload).toBe(false);
  });

  it("sends only clearHeaders when clearing", () => {
    const payload = buildAiExternalMcpHeaderPayload({ mode: "clear" });

    expect(payload.clearHeaders).toBe(true);
    expect("headers" in payload).toBe(false);
  });

  it("can never produce both keys for any draft state", () => {
    const drafts: AiExternalMcpHeaderDraft[] = [
      { mode: "keep" },
      { mode: "clear" },
      { mode: "replace", rows: [] },
      { mode: "replace", rows: [row("a", "1")] },
    ];

    for (const draft of drafts) {
      const payload = buildAiExternalMcpHeaderPayload(draft);
      const keys = Object.keys(payload);
      expect(keys.includes("headers") && keys.includes("clearHeaders")).toBe(
        false,
      );
    }
  });

  it("drops rows with a blank name", () => {
    const payload = buildAiExternalMcpHeaderPayload({
      mode: "replace",
      rows: [row("  ", "orphan"), row("X-Token", "kept")],
    });

    expect(payload.headers).toEqual({ "X-Token": "kept" });
  });

  it("trims the header name but preserves the value verbatim", () => {
    const payload = buildAiExternalMcpHeaderPayload({
      mode: "replace",
      rows: [row("  X-Token  ", "  spaced value  ")],
    });

    expect(payload.headers).toEqual({ "X-Token": "  spaced value  " });
  });

  it("does not carry a value abandoned by switching back to keep", () => {
    // The administrator typed a secret and then chose to keep the stored one.
    const payload = buildAiExternalMcpHeaderPayload({ mode: "keep" });

    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(payload).toEqual({});
  });
});

describe("validateAiExternalMcpHeaderRows", () => {
  it("accepts an empty list", () => {
    expect(validateAiExternalMcpHeaderRows([])).toEqual({ status: "ok" });
  });

  it("accepts a single named row", () => {
    expect(validateAiExternalMcpHeaderRows([row("X-Token", "v")])).toEqual({
      status: "ok",
    });
  });

  it("rejects duplicate names regardless of casing", () => {
    const result = validateAiExternalMcpHeaderRows([
      row("Authorization", "a", "1"),
      row("authorization", "b", "2"),
    ]);

    expect(result).toMatchObject({ status: "invalid", reason: "duplicate" });
  });

  it("rejects more than the allowed number of headers", () => {
    const rows = Array.from({ length: AI_EXTERNAL_MCP_MAX_HEADERS + 1 }, (_v, i) =>
      row(`x-h${i}`, "v", String(i)),
    );

    expect(validateAiExternalMcpHeaderRows(rows)).toMatchObject({
      status: "invalid",
      reason: "tooMany",
    });
  });

  it("accepts exactly the allowed number of headers", () => {
    const rows = Array.from({ length: AI_EXTERNAL_MCP_MAX_HEADERS }, (_v, i) =>
      row(`x-h${i}`, "v", String(i)),
    );

    expect(validateAiExternalMcpHeaderRows(rows)).toEqual({ status: "ok" });
  });

  it("rejects an oversized value", () => {
    const result = validateAiExternalMcpHeaderRows([
      row("x-token", "a".repeat(AI_EXTERNAL_MCP_MAX_HEADER_VALUE_LENGTH + 1)),
    ]);

    expect(result).toMatchObject({ status: "invalid", reason: "valueTooLong" });
  });

  it("rejects a value typed without a name so a credential is not silently dropped", () => {
    const result = validateAiExternalMcpHeaderRows([
      row("", "a-secret-nobody-named", "orphan"),
    ]);

    expect(result).toMatchObject({
      status: "invalid",
      reason: "nameRequired",
      rowId: "orphan",
    });
  });

  it("tolerates a fully blank row, which is just an unused editor line", () => {
    expect(validateAiExternalMcpHeaderRows([row("", "", "blank")])).toEqual({
      status: "ok",
    });
  });
});

describe("createAiExternalMcpHeaderRow", () => {
  it("starts empty so no value is ever pre-filled from elsewhere", () => {
    expect(createAiExternalMcpHeaderRow("id-1")).toEqual({
      id: "id-1",
      name: "",
      value: "",
    });
  });
});
