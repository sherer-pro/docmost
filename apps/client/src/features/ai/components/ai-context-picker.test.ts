import { describe, expect, it } from "vitest";
import { treeNodeToContextSource } from "../utils/ai-context.ts";

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
    });
  });
});
