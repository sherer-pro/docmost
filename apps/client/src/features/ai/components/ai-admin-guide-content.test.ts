import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import guideContract from "./ai-admin-guide-contract.json";
import {
  AI_ADMIN_GUIDE_ANCHORS,
  AI_ADMIN_GUIDE_CONTRACT_VERSION,
  AI_ADMIN_GUIDE_SCENARIOS,
  buildAiAdminGuideDiagrams,
  escapeMermaidLabel,
  getAiAdminGuideAnchorFromHash,
  getAiAdminGuidePanelFromHash,
} from "./ai-admin-guide-content";

describe("AI administrator guide contract", () => {
  it("keeps stable anchors and context-sensitive routes", () => {
    expect(AI_ADMIN_GUIDE_CONTRACT_VERSION).toBe(7);
    expect(AI_ADMIN_GUIDE_CONTRACT_VERSION).toBe(guideContract.version);
    expect(AI_ADMIN_GUIDE_ANCHORS).toEqual(guideContract.anchors);
    expect(getAiAdminGuideAnchorFromHash("#rag-api")).toBe("rag-api");
    expect(getAiAdminGuideAnchorFromHash("#missing")).toBeNull();
    expect(getAiAdminGuidePanelFromHash("")).toBe("overview");
    expect(getAiAdminGuidePanelFromHash("#missing")).toBe("overview");
    expect(AI_ADMIN_GUIDE_SCENARIOS.map((item) => item.settingsPath)).toEqual([
      "/settings/ai/spaces",
      "/settings/ai/spaces",
      "/settings/keys/rag",
      "/settings/ai/spaces",
      "/settings/keys/mcp",
      "/settings/ai/external-tools",
    ]);
  });

  it("escapes localized Mermaid labels without losing readable text", () => {
    expect(escapeMermaidLabel('  One [unsafe] "label"\n<script>  ')).toBe(
      "One unsafe label script",
    );
  });

  it("builds three vertical semantic diagrams without internal class names", () => {
    const translate = ((key: string) => key) as unknown as TFunction;
    const diagrams = buildAiAdminGuideDiagrams(translate);

    expect(Object.keys(diagrams)).toEqual(["overview", "rag", "mcp"]);
    for (const diagram of Object.values(diagrams)) {
      expect(diagram.source).toContain("flowchart TB");
      expect(diagram.textAlternativeKeys).toHaveLength(4);
      expect(diagram.source).not.toMatch(
        /ApiKeyService|McpApiKeyAuthGuard|PostgreSQL api_keys/u,
      );
    }
    expect(diagrams.rag.source).toContain("/api/rag/*");
    expect(diagrams.mcp.source).toContain("/mcp");
  });
});
