import { describe, expect, it } from "vitest";
import { resolvePageMentionReference } from "./mention-reference";

describe("resolvePageMentionReference", () => {
  it("uses stored label and icon when a page is missing or inaccessible", () => {
    expect(
      resolvePageMentionReference({
        slugId: "stored-slug",
        label: "Stored title",
        icon: "📄",
      }),
    ).toEqual({
      slugId: "stored-slug",
      title: "Stored title",
      icon: "📄",
    });
  });

  it("prefers fresh batch reference metadata", () => {
    expect(
      resolvePageMentionReference(
        { slugId: "old", label: "Old", icon: null },
        {
          id: "page-1",
          slugId: "new",
          title: "New",
          icon: "✨",
        },
      ),
    ).toEqual({ slugId: "new", title: "New", icon: "✨" });
  });
});
