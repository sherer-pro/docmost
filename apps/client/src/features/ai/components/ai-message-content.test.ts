import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { safeSourceUrl } from "@/features/ai/utils/source-url.ts";

describe("AI citation URLs", () => {
  it("accepts internal and http(s) source URLs", () => {
    assert.equal(safeSourceUrl("/s/team/p/page"), "/s/team/p/page");
    assert.equal(
      safeSourceUrl("https://docs.example.com/source"),
      "https://docs.example.com/source",
    );
  });

  it("rejects executable and protocol-relative source URLs", () => {
    assert.equal(safeSourceUrl("javascript:alert(1)"), null);
    assert.equal(safeSourceUrl("//evil.example/source"), null);
  });
});
