import { describe, expect, it, vi } from "vitest";
import {
  getAiLocalDraftKey,
  readAiLocalDraft,
  writeAiLocalDraft,
} from "./ai-local-draft";

describe("AI local draft", () => {
  it("isolates drafts by workspace, user, and page", () => {
    expect(getAiLocalDraftKey("workspace", "user", "page")).toBe(
      "docmost:ai-draft:workspace:user:page",
    );
  });

  it("round-trips a valid draft and rejects malformed storage", () => {
    const value = {
      text: "Continue the summary",
      useSpaceSearch: true,
      agentMode: false,
    };
    expect(
      readAiLocalDraft({ getItem: () => JSON.stringify(value) }, "draft"),
    ).toEqual(value);
    expect(
      readAiLocalDraft({ getItem: () => '{"text":1}' }, "draft"),
    ).toBeNull();
  });

  it("removes an empty draft instead of persisting an orphan", () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    writeAiLocalDraft({ setItem, removeItem }, "draft", {
      text: "",
      useSpaceSearch: false,
      agentMode: false,
    });
    expect(removeItem).toHaveBeenCalledWith("draft");
    expect(setItem).not.toHaveBeenCalled();
  });
});
