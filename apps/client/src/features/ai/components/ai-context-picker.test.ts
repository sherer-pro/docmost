import { describe, expect, it } from "vitest";
import {
  dedupeAiContextSources,
  getAiIncludedPageIds,
  treeNodeToContextSource,
} from "../utils/ai-context.ts";
import type { AiContextSource } from "@/features/ai/types/ai.types.ts";

function node(
  overrides: Record<string, unknown>,
): Parameters<typeof treeNodeToContextSource>[0] {
  return {
    id: "page-id",
    nodeType: "page",
    slugId: "page-slug",
    databaseId: null,
    name: "Source",
    position: "a0",
    spaceId: "space",
    parentPageId: null,
    hasChildren: false,
    children: [],
    ...overrides,
  } as Parameters<typeof treeNodeToContextSource>[0];
}

describe("AI context tree drops", () => {
  it("uses the database entity id for a database node", () => {
    expect(
      treeNodeToContextSource(
        node({ nodeType: "database", databaseId: "database-id" }),
      ),
    ).toMatchObject({
      sourceType: "database",
      sourceId: "database-id",
      pageId: "page-id",
      icon: null,
    });
  });

  it("uses the row page id as the resolvable drag descriptor", () => {
    expect(
      treeNodeToContextSource(
        node({ nodeType: "databaseRow", databaseId: "database-id" }),
      ),
    ).toMatchObject({
      sourceType: "database_row",
      sourceId: "page-id",
      pageId: "page-id",
      icon: null,
    });
  });

  it("preserves the tree emoji for the context descriptor", () => {
    expect(treeNodeToContextSource(node({ icon: "📚" }))).toMatchObject({
      sourceType: "page",
      sourceId: "page-id",
      icon: "📚",
    });
  });
});

describe("AI context search results", () => {
  it("deduplicates identities while preserving the first result order", () => {
    const source = (sourceId: string, title: string): AiContextSource =>
      ({
        id: `page:${sourceId}`,
        sourceType: "page",
        sourceId,
        pageId: sourceId,
        title,
        icon: null,
        breadcrumbs: [],
        url: null,
        position: 0,
        available: true,
        hasChildren: false,
        descendants: { mode: "none", pageIds: [] },
      }) as AiContextSource;

    expect(
      dedupeAiContextSources([
        source("one", "First"),
        source("one", "Duplicate"),
        source("two", "Second"),
      ]).map((item) => item.title),
    ).toEqual(["First", "Second"]);
  });

  it("deduplicates different source identities by backing page id", () => {
    const page = {
      id: "page:page-id",
      sourceType: "page",
      sourceId: "page-id",
      pageId: "page-id",
      title: "Page",
      icon: null,
      breadcrumbs: [],
      url: null,
      position: 0,
      available: true,
      hasChildren: false,
      descendants: { mode: "none", pageIds: [] },
    } as AiContextSource;
    const row = {
      ...page,
      id: "database_row:row-id",
      sourceType: "database_row",
      sourceId: "row-id",
      title: "Row",
    } as AiContextSource;

    expect(dedupeAiContextSources([page, row])).toEqual([page]);
  });

  it("treats the current page and selected descendants as already included", () => {
    const source = {
      id: "page:root",
      sourceType: "page",
      sourceId: "root",
      pageId: "root",
      title: "Root",
      icon: null,
      breadcrumbs: [],
      url: null,
      position: 0,
      available: true,
      hasChildren: true,
      descendants: { mode: "selected", pageIds: ["nested"] },
    } as AiContextSource;

    expect(
      getAiIncludedPageIds(
        {
          includeCurrentDocument: true,
          currentDocumentDescendants: {
            mode: "selected",
            pageIds: ["current-child"],
          },
          sources: [source],
        },
        "current",
      ),
    ).toEqual(new Set(["current", "current-child", "root", "nested"]));
  });
});
