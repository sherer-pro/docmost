import { describe, expect, it } from "vitest";
import {
  buildAiAssistantProfileCapabilityOptions,
  normalizeAiAssistantProfileQuickCommands,
} from "./ai-assistant-profile-form";

describe("assistant profile form helpers", () => {
  it("uses friendly tool labels without exposing capability identifiers", () => {
    const options = buildAiAssistantProfileCapabilityOptions(
      [
        {
          name: "getPage",
          capability: "page.content.read",
          category: "page_read",
          targetScope: "readable_page",
          approvalMode: "none",
          maxResultBytes: 1024,
          writeClass: "read_only",
          exposures: ["agent"],
          annotations: {
            idempotent: true,
            destructive: false,
            openWorld: false,
          },
        },
      ],
      ["page.content.read"],
      (toolName) => ({ getPage: "Read page content" })[toolName] ?? toolName,
    );

    expect(options).toEqual([
      { value: "page.content.read", label: "Read page content" },
    ]);
    expect(options[0].label).not.toContain("page.content.read");
  });

  it("preserves optional command fields and derives stable display order", () => {
    expect(
      normalizeAiAssistantProfileQuickCommands([
        {
          id: "second",
          label: "Second",
          description: "Shown in the picker",
          prompt: "Second prompt",
          enabled: false,
          position: 9,
        },
        {
          id: "first",
          label: "First",
          prompt: "First prompt",
          enabled: true,
          position: 3,
        },
      ]),
    ).toEqual([
      {
        id: "second",
        label: "Second",
        description: "Shown in the picker",
        prompt: "Second prompt",
        enabled: false,
        position: 0,
      },
      {
        id: "first",
        label: "First",
        prompt: "First prompt",
        enabled: true,
        position: 1,
      },
    ]);
  });
});
