// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  isDuplicateTextHighlight,
  withSearchQuery,
  getSearchPropertyTarget,
} from "./search-result-utils";

describe("isDuplicateTextHighlight", () => {
  it("preserves exact structured property targets and encodes the search term", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const href = withSearchQuery(
      "/s/s/p/row?record=abc#anchor",
      "=SUM & 50%",
      id,
    );
    const url = new URL(href, "https://docmost.invalid");
    expect(url.searchParams.get("find")).toBe("=SUM & 50%");
    expect(url.searchParams.get("findProperty")).toBe(id);
    expect(url.searchParams.get("record")).toBe("abc");
    expect(url.hash).toBe("#anchor");
    expect(getSearchPropertyTarget(url.search)).toBe(id);
    expect(getSearchPropertyTarget("?findProperty=property-1")).toBeNull();
    expect(
      getSearchPropertyTarget("?findProperty=%22%5D%5Bdata-secret%5D"),
    ).toBeNull();
  });
  it("preserves anchors and query parameters when linking to a search match", () => {
    expect(
      withSearchQuery("/s/space/p/page?record=123#tag-todo", " C++ & дата "),
    ).toBe(
      "/s/space/p/page?record=123&find=C%2B%2B+%26+%D0%B4%D0%B0%D1%82%D0%B0#tag-todo",
    );
    expect(withSearchQuery("/s/space/p/page#tag-todo", " ")).toBe(
      "/s/space/p/page#tag-todo",
    );
  });
  it("suppresses a text highlight already represented by a tag snippet", () => {
    expect(
      isDuplicateTextHighlight("Review <mark>TODO</mark>", [
        {
          text: "Review TODO",
          matches: [{ start: 7, end: 11, value: "todo" }],
        },
      ]),
    ).toBe(true);
  });

  it("keeps a text highlight from a different block", () => {
    expect(
      isDuplicateTextHighlight("Policy <mark>owner</mark>", [
        {
          text: "Review TODO",
          matches: [{ start: 7, end: 11, value: "todo" }],
        },
      ]),
    ).toBe(false);
  });
});
