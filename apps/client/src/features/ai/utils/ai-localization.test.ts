import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_ERROR_CODES } from "@docmost/api-contract";
import {
  getAiErrorTranslationKey,
  resolveAiErrorMessage,
} from "./ai-policies.ts";
import guideContract from "@/features/ai/components/ai-admin-guide-contract.json";
import { buildAiAdminGuideDiagrams } from "@/features/ai/components/ai-admin-guide-content.ts";

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
const PROFILE_ERROR_REASON_KEYS = [
  "errorReason.profileDisabled",
  "errorReason.profileNotAllowed",
  "errorReason.profileLocked",
  "errorReason.profileVersionConflict",
  "errorReason.agentProfileUnverified",
  "errorReason.agentProfilePolicyChanged",
  "errorReason.agentProviderConfigChanged",
];
const PROFILE_IDENTICAL_VALUE_ALLOWLIST: Record<string, Set<string>> = {
  "de-DE": new Set(["profiles.name"]),
  "fr-FR": new Set(["profiles.profileDescription", "profiles.instructions"]),
};
const GUIDE_IDENTICAL_VALUE_ALLOWLIST: Record<string, Set<string>> = {
  "de-DE": new Set(["labels.route"]),
  "nl-NL": new Set(["labels.route"]),
};
const GUIDE_GLOBAL_IDENTICAL_VALUE_ALLOWLIST = new Set([
  "troubleshooting.rows.401.signal",
  "troubleshooting.rows.409.signal",
  "troubleshooting.rows.429.signal",
  "troubleshooting.rows.503.signal",
  "troubleshooting.rows.sourceAccessChanged.signal",
  "troubleshooting.rows.targetMismatch.signal",
  "troubleshooting.groups.mcp",
  "troubleshooting.groups.ragSync",
]);
const BUILTIN_TOOL_NAMES = [
  "search",
  "getTree",
  "getPageContext",
  "getPage",
  "getOutline",
  "getNode",
  "searchInPage",
  "getWorkspaceContext",
  "getSpaceContext",
  "getDatabaseContext",
  "listDatabaseRows",
  "getDatabaseRowContext",
  "getTable",
  "listComments",
  "listPageHistory",
  "diffPageVersion",
  "listTransclusionReferences",
  "listPageAttachments",
  "getPublicShareInfo",
  "listPageTemplates",
  "getPageTemplateMetadata",
  "listPageTemplateUsages",
  "editPageText",
  "patchNode",
  "insertNode",
  "deleteNode",
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
      "errorReason.agentToolPolicyChanged",
      "settings.title",
      "ragSync.title",
      "ragSync.privacyDescription",
      "integrations.section.ragSync",
      "toolPolicy.workspaceTitle",
      "toolPolicy.deploymentDisabled",
      "toolPolicy.copyCapabilityIdentifier",
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

  it("localizes MCP capability policy states in every supported locale", () => {
    const keys = [
      "capabilities",
      "capabilitiesDescription",
      "capabilitiesLoading",
      "capabilitiesLoadFailed",
      "noCapabilities",
      "capabilitiesRevoked",
      "removeUnavailableCapabilities",
      "validation.capabilityRequired",
    ];
    const english = flatten(
      readLocale("en-US").apiKeys as Record<string, unknown>,
    );

    for (const locale of LOCALES.filter((value) => value !== "en-US")) {
      const localized = flatten(
        readLocale(locale).apiKeys as Record<string, unknown>,
      );
      for (const key of keys) {
        expect(localized[key]).toBeTruthy();
        expect(localized[key]).not.toBe(english[key]);
      }
    }
  });

  it("localizes every built-in tool name in every supported locale", () => {
    const english = flatten(readAiLocale("en-US"));

    for (const locale of LOCALES) {
      const localized = flatten(readAiLocale(locale));
      for (const toolName of BUILTIN_TOOL_NAMES) {
        const key = `toolPolicy.tool.${toolName}`;
        expect(localized[key]).toBeTruthy();
        expect(localized[key]).not.toBe(toolName);
        if (locale !== "en-US") {
          expect(localized[key]).not.toBe(english[key]);
        }
      }
    }
  });

  it("localizes the complete assistant profile surface", () => {
    const english = flatten(readAiLocale("en-US"));
    const profileKeys = [
      ...Object.keys(english).filter((key) => key.startsWith("profiles.")),
      "integrations.section.profiles",
      ...PROFILE_ERROR_REASON_KEYS,
    ];
    expect(profileKeys).toHaveLength(73);

    for (const locale of LOCALES.filter((value) => value !== "en-US")) {
      const localized = flatten(readAiLocale(locale));
      const allowlist = PROFILE_IDENTICAL_VALUE_ALLOWLIST[locale] ?? new Set();

      for (const key of profileKeys) {
        expect(localized[key]).toBeTruthy();
        if (!allowlist.has(key)) {
          expect(localized[key]).not.toBe(english[key]);
        }
        expect(localized[key].match(/{{[^}]+}}/g) ?? []).toEqual(
          english[key].match(/{{[^}]+}}/g) ?? [],
        );
      }
    }
  });

  it("localizes the complete administrator AI guide", () => {
    const english = flatten(readAiLocale("en-US"));
    const guideKeys = Object.keys(english).filter((key) =>
      key.startsWith("adminGuide."),
    );
    const manifestedKeys = guideContract.requiredKeys.map(
      (key) => `adminGuide.${key}`,
    );

    expect(guideKeys.sort()).toEqual(manifestedKeys.sort());

    for (const locale of LOCALES.filter((value) => value !== "en-US")) {
      const localized = flatten(readAiLocale(locale));
      const allowlist = GUIDE_IDENTICAL_VALUE_ALLOWLIST[locale] ?? new Set();
      for (const key of manifestedKeys) {
        expect(localized[key]).toBeTruthy();
        const guideKey = key.replace(/^adminGuide\./u, "");
        if (
          !allowlist.has(guideKey) &&
          !GUIDE_GLOBAL_IDENTICAL_VALUE_ALLOWLIST.has(guideKey)
        ) {
          expect(localized[key]).not.toBe(english[key]);
        }
        expect(localized[key].match(/{{[^}]+}}/g) ?? []).toEqual(
          english[key].match(/{{[^}]+}}/g) ?? [],
        );
      }
    }
  });

  it("keeps explicit guide fields and localized Mermaid sources valid", () => {
    for (const locale of LOCALES) {
      const ai = readAiLocale(locale);
      const translate = ((key: string) => {
        const segments = key.replace(/^ai\./u, "").split(".");
        let value: unknown = ai;
        for (const segment of segments) {
          value = (value as Record<string, unknown>)[segment];
        }
        return value as string;
      }) as any;

      for (const scenario of [
        "assistant",
        "retrieval",
        "ragApi",
        "ragSync",
        "inboundMcp",
        "outboundMcp",
      ]) {
        for (const field of [
          "description",
          "owner",
          "prerequisite",
          "result",
          "steps.step1",
          "steps.step2",
          "steps.step3",
          "success",
          "rollback",
          "technical",
        ]) {
          expect(
            translate(`ai.adminGuide.scenario.${scenario}.${field}`),
          ).toBeTruthy();
        }
      }

      for (const row of [
        "401",
        "409",
        "429",
        "503",
        "leaseLost",
        "sourceAccessChanged",
        "sourceRemoved",
        "runtimeStopped",
        "cleanupRequired",
        "consentRevoked",
      ]) {
        expect(
          translate(`ai.adminGuide.troubleshooting.rows.${row}.signal`),
        ).toBeTruthy();
        expect(
          translate(`ai.adminGuide.troubleshooting.rows.${row}.action`),
        ).toBeTruthy();
      }

      const diagrams = buildAiAdminGuideDiagrams(translate);
      expect(Object.keys(diagrams)).toEqual(["overview", "rag", "mcp"]);
      for (const diagram of Object.values(diagrams)) {
        expect(diagram.source).toMatch(/^flowchart TB/u);
        expect(diagram.source).not.toContain("<script");
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
