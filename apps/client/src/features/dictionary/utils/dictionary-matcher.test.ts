import { describe, expect, it } from "vitest";
import {
  createDictionaryMatcherIndex,
  findDictionaryMatches,
} from "./dictionary-matcher";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";

function term(
  id: string,
  value: string,
  forms: string[] = [],
): IDictionaryTerm {
  return {
    id,
    spaceId: "space-1",
    workspaceId: "workspace-1",
    term: value,
    forms,
    definitionMarkdown: "Definition",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("dictionary matcher", () => {
  it("matches terms and forms as whole words without case sensitivity", () => {
    const index = createDictionaryMatcherIndex([
      term("term-1", "Адыгея", ["Адыгеи"]),
    ]);
    const matches = findDictionaryMatches("Адыгея и адыгеи.", index);

    expect(matches.map((match) => match.matchedText)).toEqual([
      "Адыгея",
      "адыгеи",
    ]);
  });

  it("matches multi-word phrases across whitespace", () => {
    const index = createDictionaryMatcherIndex([
      term("term-1", "machine learning"),
    ]);
    const matches = findDictionaryMatches(
      "Machine \n\t learning works.",
      index,
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].matchedText).toBe("Machine \n\t learning");
  });

  it("does not match aliases inside larger words", () => {
    const index = createDictionaryMatcherIndex([term("term-1", "cat")]);
    const matches = findDictionaryMatches("cat scatter catalog", index);

    expect(matches.map((match) => match.matchedText)).toEqual(["cat"]);
  });

  it("keeps the longest overlapping match", () => {
    const index = createDictionaryMatcherIndex([
      term("term-1", "New"),
      term("term-2", "New York"),
    ]);
    const matches = findDictionaryMatches("New York office", index);

    expect(matches).toHaveLength(1);
    expect(matches[0].term.id).toBe("term-2");
  });

  it("keeps the first matching term when duplicate aliases exist", () => {
    const index = createDictionaryMatcherIndex([
      term("term-1", "duplicate"),
      term("term-2", "duplicate"),
    ]);
    const matches = findDictionaryMatches("duplicate", index);

    expect(matches).toHaveLength(1);
    expect(matches[0].term.id).toBe("term-1");
  });

  it("escapes aliases before building the combined regex", () => {
    const index = createDictionaryMatcherIndex([
      term("term-1", "C++"),
      term("term-2", "price (net)"),
    ]);
    const matches = findDictionaryMatches(
      "C++ and price (net), not C++17.",
      index,
    );

    expect(matches.map((match) => match.alias)).toEqual(["C++", "price (net)"]);
  });

  it("matches across multiple large index chunks", () => {
    const terms = Array.from({ length: 650 }, (_, index) =>
      term(`term-${index}`, `Term ${index}`, [`Term ${index} alias`]),
    );
    const matcherIndex = createDictionaryMatcherIndex(terms);
    const matches = findDictionaryMatches(
      "Term 12 alias and Term 640 alias are present.",
      matcherIndex,
    );

    expect(matches.map((match) => match.alias)).toEqual([
      "Term 12 alias",
      "Term 640 alias",
    ]);
  });

  it("keeps the legacy terms argument for low-frequency callers", () => {
    const matches = findDictionaryMatches("Alpha beta", [
      term("term-1", "alpha"),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0].alias).toBe("alpha");
  });

  it("matches canonically equivalent composed and decomposed text", () => {
    const index = createDictionaryMatcherIndex([term("term-1", "é")]);
    const matches = findDictionaryMatches("Cafe e\u0301!", index);

    expect(matches).toEqual([
      expect.objectContaining({
        from: 5,
        to: 7,
        matchedText: "e\u0301",
      }),
    ]);
  });

  it("maps compatibility-normalized matches to original positions", () => {
    const index = createDictionaryMatcherIndex([
      term("term-1", "ABC"),
      term("term-2", "ffi"),
    ]);
    const matches = findDictionaryMatches("ＡＢＣ and ﬃ", index);

    expect(
      matches.map(({ from, to, matchedText }) => ({
        from,
        to,
        matchedText,
      })),
    ).toEqual([
      { from: 0, to: 3, matchedText: "ＡＢＣ" },
      { from: 8, to: 9, matchedText: "ﬃ" },
    ]);
  });

  it("does not end a word before a combining mark", () => {
    const index = createDictionaryMatcherIndex([term("term-1", "e")]);

    expect(findDictionaryMatches("e\u0338", index)).toHaveLength(0);
  });
});
