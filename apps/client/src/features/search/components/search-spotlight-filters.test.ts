import { describe, expect, it } from "vitest";
import { builtInTagDefinitions } from "@docmost/editor-ext";
import { getSearchContentTypeOptions } from "./search-content-type-options";
import {
  getSearchFilterPayload,
  sameSearchTags,
  shouldClearUnavailableSearchTags,
  shouldShowSearchTagFilter,
} from "./search-filter-state";

describe("getSearchContentTypeOptions", () => {
  it("names the page, database, and row scope as documents", () => {
    expect(getSearchContentTypeOptions((value) => value)[0]).toEqual({
      value: "page",
      label: "Documents",
    });
  });

  it("exposes attachments without feature-gating metadata", () => {
    const options = getSearchContentTypeOptions((value) => value);
    const attachmentOption = options.find(
      (option) => option.value === "attachment",
    );

    expect(attachmentOption).toEqual({
      value: "attachment",
      label: "Attachments",
    });
    expect(attachmentOption).not.toHaveProperty("disabled");
  });
});

describe("getSearchFilterPayload", () => {
  it("exposes every built-in tag to search", () => {
    expect(builtInTagDefinitions.map((tag) => tag.label)).toEqual([
      "TBD",
      "TODO",
      "DONE",
    ]);
  });

  it("keeps a single selected label for page search", () => {
    expect(
      getSearchFilterPayload({
        spaceId: "space-1",
        contentType: "page",
        label: { id: "label-1", name: "urgent" },
        tags: [],
      }),
    ).toEqual({
      spaceId: "space-1",
      contentType: "page",
      labelId: "label-1",
      tags: [],
    });
  });

  it("keeps a selected tag for page search", () => {
    expect(
      getSearchFilterPayload({
        spaceId: null,
        contentType: "page",
        label: null,
        tags: ["done"],
      }),
    ).toMatchObject({
      contentType: "page",
      labelId: null,
      tags: ["done"],
    });
  });

  it("clears the label filter for attachment search", () => {
    expect(
      getSearchFilterPayload({
        spaceId: null,
        contentType: "attachment",
        label: { id: "label-1", name: "urgent" },
        tags: ["todo"],
      }),
    ).toMatchObject({
      contentType: "attachment",
      labelId: null,
      tags: [],
    });
  });
});

describe("tag filter visibility", () => {
  it("hides the filter when the selected scope has no accessible tag facets", () => {
    expect(
      shouldShowSearchTagFilter({
        disabled: false,
        selectedTags: [],
        availableTags: [],
      }),
    ).toBe(false);
  });

  it("keeps an active selection visible until loaded facets can reset it", () => {
    expect(
      shouldShowSearchTagFilter({
        disabled: false,
        selectedTags: ["todo"],
        availableTags: [],
      }),
    ).toBe(true);
    expect(
      shouldClearUnavailableSearchTags({
        disabled: false,
        facetsLoaded: true,
        selectedTags: ["todo"],
        availableTags: [],
      }),
    ).toBe(true);
  });

  it("hides the filter and clears no selection in attachment mode", () => {
    expect(
      shouldShowSearchTagFilter({
        disabled: true,
        selectedTags: [],
        availableTags: ["todo"],
      }),
    ).toBe(false);
    expect(
      shouldClearUnavailableSearchTags({
        disabled: true,
        facetsLoaded: true,
        selectedTags: ["todo"],
        availableTags: [],
      }),
    ).toBe(false);
  });
});

describe("tag presets", () => {
  it("compares presets without depending on selection order", () => {
    expect(
      sameSearchTags(["done", "tbd", "todo"], ["tbd", "todo", "done"]),
    ).toBe(true);
    expect(sameSearchTags(["todo", "tbd"], ["tbd", "todo"])).toBe(true);
    expect(sameSearchTags(["done"], ["tbd", "todo", "done"])).toBe(false);
  });
});
