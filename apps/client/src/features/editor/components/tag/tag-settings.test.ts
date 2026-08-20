import { describe, expect, it } from "vitest";
import {
  getEnabledTagDefinitions,
  normalizeDisabledTags,
} from "./tag-settings";

describe("tag settings", () => {
  it("normalizes disabled built-in tags", () => {
    expect(
      normalizeDisabledTags([
        " TODO ",
        "done",
        " Core ",
        "FUTURE",
        "pilot",
        "missing",
        "core",
      ]),
    ).toEqual(["todo", "done", "core", "future", "pilot"]);
  });

  it("reads legacy JSON-encoded tag arrays", () => {
    expect(normalizeDisabledTags('["todo","done"]')).toEqual(["todo", "done"]);
    expect(
      getEnabledTagDefinitions({ disabled: '["todo","done"]' }).map(
        (tag) => tag.value,
      ),
    ).not.toEqual(expect.arrayContaining(["todo", "done"]));
  });

  it("ignores malformed legacy values", () => {
    expect(normalizeDisabledTags("not-json")).toEqual([]);
  });

  it("keeps new tags enabled for an old disabled list", () => {
    expect(
      getEnabledTagDefinitions({ disabled: ["tbd", "todo", "done"] }).map(
        (tag) => tag.value,
      ),
    ).toEqual(["core", "future", "pilot"]);
  });
});
