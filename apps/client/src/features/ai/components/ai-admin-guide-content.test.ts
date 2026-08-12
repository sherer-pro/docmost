import { describe, expect, it } from "vitest";
import guideContract from "./ai-admin-guide-contract.json";
import {
  AI_ADMIN_GUIDE_ANCHORS,
  AI_ADMIN_GUIDE_CONTRACT_VERSION,
  AI_ADMIN_GUIDE_SCENARIOS,
  escapeMermaidLabel,
  getAiAdminGuideAnchorFromHash,
  splitAiAdminGuideFields,
} from "./ai-admin-guide-content";

describe("AI administrator guide contract", () => {
  it("keeps stable anchors and context-sensitive routes", () => {
    expect(AI_ADMIN_GUIDE_CONTRACT_VERSION).toBe(guideContract.version);
    expect(AI_ADMIN_GUIDE_ANCHORS).toEqual(guideContract.anchors);
    expect(getAiAdminGuideAnchorFromHash("#rag-api")).toBe("rag-api");
    expect(getAiAdminGuideAnchorFromHash("#missing")).toBeNull();
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

  it("rejects malformed compact localized fields", () => {
    expect(splitAiAdminGuideFields("owner||requires||result", 3)).toEqual([
      "owner",
      "requires",
      "result",
    ]);
    expect(splitAiAdminGuideFields("owner||missing", 3)).toEqual([]);
    expect(splitAiAdminGuideFields("owner||||result", 3)).toEqual([]);
  });
});
