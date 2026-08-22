// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { buildAiUploadIdempotencyPayload } from "./ai-upload-idempotency";

describe("AI upload idempotency payload", () => {
  it("binds the lease to conversation, file order, metadata, and content", async () => {
    const first = new File(["alpha"], "first.txt", { type: "text/plain" });
    const second = new File(["beta"], "second.txt", { type: "text/plain" });

    const payload = await buildAiUploadIdempotencyPayload("conversation-1", [
      first,
      second,
    ]);
    const repeated = await buildAiUploadIdempotencyPayload("conversation-1", [
      new File(["alpha"], "first.txt", { type: "text/plain" }),
      new File(["beta"], "second.txt", { type: "text/plain" }),
    ]);
    const reversed = await buildAiUploadIdempotencyPayload("conversation-1", [
      second,
      first,
    ]);

    expect(repeated).toEqual(payload);
    expect(reversed.files).not.toEqual(payload.files);
    expect(payload.files[0].mimeType).toBe("text/plain");
    expect(payload.files[0].sha256).toMatch(/^[a-f0-9]{64}$/u);

    const changedMime = await buildAiUploadIdempotencyPayload(
      "conversation-1",
      [new File(["alpha"], "first.txt", { type: "application/octet-stream" })],
    );
    expect(changedMime.files[0]).not.toEqual(payload.files[0]);
  });
});
