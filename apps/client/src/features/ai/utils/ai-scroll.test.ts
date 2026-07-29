import { describe, expect, it } from "vitest";
import { AI_CHAT_BOTTOM_THRESHOLD, isAiChatNearBottom } from "./ai-scroll.ts";

describe("AI chat scroll policy", () => {
  it("follows output at the bottom and within the bottom threshold", () => {
    expect(
      isAiChatNearBottom({
        scrollHeight: 1000,
        scrollTop: 600,
        clientHeight: 400,
      }),
    ).toBe(true);
    expect(
      isAiChatNearBottom({
        scrollHeight: 1000,
        scrollTop: 600 - AI_CHAT_BOTTOM_THRESHOLD,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  it("stops following output above the bottom threshold", () => {
    expect(
      isAiChatNearBottom({
        scrollHeight: 1000,
        scrollTop: 600 - AI_CHAT_BOTTOM_THRESHOLD - 1,
        clientHeight: 400,
      }),
    ).toBe(false);
  });
});
