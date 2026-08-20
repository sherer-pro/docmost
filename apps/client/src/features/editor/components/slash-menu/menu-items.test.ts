import { describe, expect, it } from "vitest";
import { builtInTagDefinitions } from "@docmost/editor-ext";
import { getEnabledTagDefinitions } from "@/features/editor/components/tag/tag-settings";
import { getSuggestionItems } from "./menu-items";

describe("tag slash menu", () => {
  it("opens a tag picker from enabled space tags", () => {
    const items = getSuggestionItems({ query: "tag" });
    const tagItem = items.basic.find((item) => item.title === "Tag");
    const enabledTags = getEnabledTagDefinitions({ disabled: ["done"] });
    const children =
      typeof tagItem?.children === "function"
        ? tagItem.children({
            storage: {
              tag: {
                tagDefinitions: enabledTags,
              },
            },
          } as any)
        : [];

    expect(tagItem).toBeTruthy();
    expect(children.map((item) => item.title)).toEqual([
      "Tag TBD",
      "Tag TODO",
      "Tag Core",
      "Tag Future",
      "Tag Pilot",
    ]);
    expect(builtInTagDefinitions.map((tag) => tag.titleKey)).toContain(
      "Tag DONE",
    );
  });

  it("keeps the tag picker empty when every space tag is disabled", () => {
    const items = getSuggestionItems({ query: "tag" });
    const tagItem = items.basic.find((item) => item.title === "Tag");
    const children =
      typeof tagItem?.children === "function"
        ? tagItem.children({
            storage: { tag: { tagDefinitions: [] } },
          } as any)
        : [];

    expect(children).toEqual([]);
  });
});
