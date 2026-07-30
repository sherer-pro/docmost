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

  it("persists an empty local marker without creating a server orphan", () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const draft = {
      text: "",
      useSpaceSearch: false,
      agentMode: false,
    };
    writeAiLocalDraft({ setItem, removeItem }, "draft", draft);
    expect(setItem).toHaveBeenCalledWith("draft", JSON.stringify(draft));
    expect(removeItem).not.toHaveBeenCalled();
  });
});
