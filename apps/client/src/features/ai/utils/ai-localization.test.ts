import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_ERROR_CODES } from "@docmost/api-contract";
import {
  getAiErrorTranslationKey,
  resolveAiErrorMessage,
} from "./ai-policies.ts";

const LOCALES = [
  "de-DE",
  "en-US",
  "es-ES",
  "fr-FR",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "nl-NL",
  "pt-BR",
  "ru-RU",
  "uk-UA",
  "zh-CN",
];

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        process.cwd(),
        "public",
        "locales",
        locale,
        "translation.json",
      ),
      "utf8",
    ),
  );
}

function readAiLocale(locale: string): Record<string, unknown> {
  return readLocale(locale).ai as Record<string, unknown>;
}

function flatten(
  value: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      result[childPath] = child;
    } else {
      Object.assign(
        result,
        flatten(child as Record<string, unknown>, childPath),
      );
    }
  }
  return result;
}

describe("AI localization contract", () => {
  it("keeps every AI key present and translated in all supported locales", () => {
    const english = flatten(readAiLocale("en-US"));
    const criticalKeys = [
      "title",
      "generationFailed",
      "context.title",
      "selection.title",
      "errorReason.unknown",
      "settings.title",
    ];

    for (const locale of LOCALES) {
      const localized = flatten(readAiLocale(locale));
      expect(Object.keys(localized).sort()).toEqual(
        Object.keys(english).sort(),
      );
      expect(Object.values(localized).every((value) => value.trim())).toBe(
        true,
      );
      if (locale !== "en-US") {
        for (const key of criticalKeys) {
          expect(localized[key]).not.toBe(english[key]);
        }
        expect(readLocale(locale)["Close panel"]).not.toBe("Close panel");
      }
    }
  });

  it("maps every stable AI error code to a localized key", () => {
    const english = flatten(readAiLocale("en-US"));
    for (const errorCode of AI_ERROR_CODES) {
      const key = getAiErrorTranslationKey(errorCode);
      expect(key).not.toBe("ai.errorReason.unknown");
      expect(english[key.replace(/^ai\./, "")]).toBeTruthy();
    }
  });

  it("keeps named assistant templates complete in every locale", () => {
    const templateGroups = [
      "titleNamed",
      "openPanelNamed",
      "loadFailedNamed",
      "openDocumentNamed",
      "unavailableNamed",
      "settings.enableNamed",
    ];

    for (const locale of LOCALES) {
      const localized = flatten(readAiLocale(locale));
      for (const group of templateGroups) {
        for (const gender of ["masculine", "feminine"]) {
          expect(localized[`${group}.${gender}`]).toContain(
            "{{assistantName}}",
          );
        }
      }
    }
  });

  it("never returns a raw translation key when locale data is missing", () => {
    const message = resolveAiErrorMessage(
      ((key: string) => key) as any,
      { exists: () => false } as any,
      "unexpected_error",
    );
    expect(message).not.toContain("ai.");
  });
});
