import { describe, expect, it } from "vitest";
import {
  getTemplateSyncErrorLabel,
  getTemplateSyncRunLabel,
  isTemplateSyncRunNonTerminal,
} from "./template-sync-status";

const t = (key: string) => `localized:${key}`;

describe("template synchronization labels", () => {
  it("maps run statuses to localized product labels", () => {
    expect(getTemplateSyncRunLabel("pending", t)).toBe("localized:Queued");
    expect(getTemplateSyncRunLabel("running", t)).toBe("localized:Updating");
    expect(getTemplateSyncRunLabel("partial", t)).toBe(
      "localized:Partially updated",
    );
    expect(getTemplateSyncRunLabel("failed", t)).toBe(
      "localized:Update failed",
    );
  });

  it("treats only queued and running work as non-terminal", () => {
    expect(isTemplateSyncRunNonTerminal("pending")).toBe(true);
    expect(isTemplateSyncRunNonTerminal("running")).toBe(true);
    expect(isTemplateSyncRunNonTerminal("completed")).toBe(false);
    expect(isTemplateSyncRunNonTerminal("partial")).toBe(false);
    expect(isTemplateSyncRunNonTerminal("failed")).toBe(false);
  });

  it("never exposes an unknown raw error code", () => {
    expect(getTemplateSyncErrorLabel("future_internal_code", t)).toBe(
      "localized:Synchronization could not be completed.",
    );
    expect(
      getTemplateSyncErrorLabel("page_template_attachment_unavailable", t),
    ).toBe("localized:A template attachment could not be copied.");
  });
});
