import { describe, expect, it } from "vitest";
import { PAGE_AI_ROLE } from "@docmost/api-contract";
import {
  AI_ROLE_OPTIONS,
  DEFAULT_AI_ROLE,
} from "./ai-role-options";

describe("AI role options", () => {
  it("keeps the product-defined default and option order", () => {
    expect(DEFAULT_AI_ROLE).toBe(PAGE_AI_ROLE.NONE);
    expect(AI_ROLE_OPTIONS.map((option) => option.value)).toEqual([
      PAGE_AI_ROLE.NONE,
      PAGE_AI_ROLE.EDITOR,
      PAGE_AI_ROLE.COAUTHOR,
      PAGE_AI_ROLE.COAUTHOR_PLUS,
      PAGE_AI_ROLE.AUTHOR,
    ]);
  });

  it("defines the requested labels, colors, and tooltip keys", () => {
    expect(AI_ROLE_OPTIONS.map((option) => option.label)).toEqual([
      "None",
      "Editor",
      "Coauthor",
      "Coauthor+",
      "Author",
    ]);
    expect(AI_ROLE_OPTIONS.map((option) => option.color)).toEqual([
      "gray.4",
      "green.6",
      "cyan.5",
      "blue.9",
      "red.6",
    ]);
    expect(AI_ROLE_OPTIONS.map((option) => option.tooltip)).toEqual([
      "AI was not used to create or edit this document.",
      "AI was used only to edit and improve text written by a person.",
      "A person and AI contributed about equally.",
      "AI created most of the content; a person guided, reviewed, and refined it.",
      "AI created the document without meaningful human contribution.",
    ]);
  });
});
