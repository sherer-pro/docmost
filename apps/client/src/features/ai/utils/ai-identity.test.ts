import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  buildAiAssistantIdentityUpdate,
  hasInvalidAiAssistantNameCharacters,
  resolveAiAssistantName,
  resolveAiAssistantText,
} from "./ai-identity.ts";

const translations: Record<string, string> = {
  "ai.title": "ИИ-помощник",
  "ai.titleNamed.masculine": "Помощник «{{assistantName}}»",
  "ai.titleNamed.feminine": "Помощница «{{assistantName}}»",
  "ai.openPanel": "Открыть ИИ-помощника",
  "ai.openPanelNamed.masculine":
    "Открыть помощника «{{assistantName}}»",
  "ai.openPanelNamed.feminine":
    "Открыть помощницу «{{assistantName}}»",
  "ai.unavailableNamed.masculine":
    "Помощник «{{assistantName}}» недоступен",
  "ai.unavailableNamed.feminine":
    "Помощница «{{assistantName}}» недоступна",
};

const t = ((key: string, values?: { assistantName?: string }) =>
  (translations[key] ?? key).replace(
    "{{assistantName}}",
    values?.assistantName ?? "",
  )) as TFunction;

describe("AI assistant identity", () => {
  it("uses the localized fallback when no active identity exists", () => {
    expect(resolveAiAssistantName(t, null)).toBe("ИИ-помощник");
    expect(resolveAiAssistantText(t, "openPanel", null)).toBe(
      "Открыть ИИ-помощника",
    );
  });

  it.each([
    [
      "masculine" as const,
      "Открыть помощника «Алиса»",
      "Помощник «Алиса» недоступен",
    ],
    [
      "feminine" as const,
      "Открыть помощницу «Алиса»",
      "Помощница «Алиса» недоступна",
    ],
  ])("selects %s templates without changing the name", (
    gender,
    open,
    unavailable,
  ) => {
    const identity = { name: "Алиса", gender };

    expect(resolveAiAssistantName(t, identity)).toBe(
      gender === "masculine"
        ? "Помощник «Алиса»"
        : "Помощница «Алиса»",
    );
    expect(resolveAiAssistantText(t, "openPanel", identity)).toBe(open);
    expect(resolveAiAssistantText(t, "unavailable", identity)).toBe(
      unavailable,
    );
  });

  it("omits retained identity values from a disabling update", () => {
    expect(
      buildAiAssistantIdentityUpdate({
        assistantNameEnabled: false,
        assistantName: "Алиса",
        assistantGender: "feminine",
      }),
    ).toEqual({ assistantNameEnabled: false });
    expect(
      buildAiAssistantIdentityUpdate({
        assistantNameEnabled: true,
        assistantName: "  Макс 🤖  ",
        assistantGender: "masculine",
      }),
    ).toEqual({
      assistantNameEnabled: true,
      assistantName: "Макс 🤖",
      assistantGender: "masculine",
    });
  });

  it("rejects control and bidi formatting characters", () => {
    expect(hasInvalidAiAssistantNameCharacters("Alice\nAdmin")).toBe(true);
    expect(hasInvalidAiAssistantNameCharacters("Alice\u202e")).toBe(true);
    expect(hasInvalidAiAssistantNameCharacters("Алиса 🤖 / R&D")).toBe(
      false,
    );
  });
});
