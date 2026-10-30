// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  isDuplicateTextHighlight,
  withSearchQuery,
} from "./search-result-utils";

describe("isDuplicateTextHighlight", () => {
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
