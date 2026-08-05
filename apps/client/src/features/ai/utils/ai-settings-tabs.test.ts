import { describe, expect, it } from "vitest";
import {
  AI_SETTINGS_DEFAULT_TAB,
  AI_SETTINGS_TABS,
  isAiSettingsTab,
} from "@/features/ai/utils/ai-settings-tabs.ts";

describe("isAiSettingsTab", () => {
  it.each(AI_SETTINGS_TABS)("accepts %s", (tab) => {
    expect(isAiSettingsTab(tab)).toBe(true);
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["spaces/"],
    ["built_in_tools"],
    ["external_tools"],
    // The inbound MCP key-type tabs must not resolve here.
    ["mcp"],
    ["rag"],
  ])("rejects %p", (value) => {
    expect(isAiSettingsTab(value)).toBe(false);
  });

  it("defaults to the spaces tab so the existing entry point is unchanged", () => {
    expect(AI_SETTINGS_DEFAULT_TAB).toBe("spaces");
    expect(isAiSettingsTab(AI_SETTINGS_DEFAULT_TAB)).toBe(true);
  });
});
