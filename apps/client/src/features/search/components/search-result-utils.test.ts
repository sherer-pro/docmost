// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { isDuplicateTextHighlight } from "./search-result-utils";

describe("isDuplicateTextHighlight", () => {
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
