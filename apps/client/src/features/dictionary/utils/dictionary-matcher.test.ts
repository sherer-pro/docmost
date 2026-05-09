import { describe, expect, it } from "vitest";
import { findDictionaryMatches } from "./dictionary-matcher";
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
    const matches = findDictionaryMatches("Адыгея и адыгеи.", [
      term("term-1", "Адыгея", ["Адыгеи"]),
    ]);

    expect(matches.map((match) => match.matchedText)).toEqual([
      "Адыгея",
      "адыгеи",
    ]);
  });

  it("matches multi-word phrases across whitespace", () => {
    const matches = findDictionaryMatches("Machine   learning works.", [
      term("term-1", "machine learning"),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0].matchedText).toBe("Machine   learning");
  });

  it("does not match aliases inside larger words", () => {
    const matches = findDictionaryMatches("cat scatter catalog", [
      term("term-1", "cat"),
    ]);

    expect(matches.map((match) => match.matchedText)).toEqual(["cat"]);
  });

  it("keeps the longest overlapping match", () => {
    const matches = findDictionaryMatches("New York office", [
      term("term-1", "New"),
      term("term-2", "New York"),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0].term.id).toBe("term-2");
  });
});
