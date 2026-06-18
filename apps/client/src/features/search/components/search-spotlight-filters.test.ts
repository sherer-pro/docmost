import { describe, expect, it } from "vitest";
import { getSearchContentTypeOptions } from "./search-content-type-options";
import { getSearchFilterPayload } from "./search-filter-state";

describe("getSearchContentTypeOptions", () => {
  it("exposes attachments without enterprise gating metadata", () => {
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
  it("keeps a single selected label for page search", () => {
    expect(
      getSearchFilterPayload({
        spaceId: "space-1",
        contentType: "page",
        label: { id: "label-1", name: "urgent" },
        isAiMode: false,
      }),
    ).toEqual({
      spaceId: "space-1",
      contentType: "page",
      labelId: "label-1",
    });
  });

  it("clears the label filter for attachment search", () => {
    expect(
      getSearchFilterPayload({
        spaceId: null,
        contentType: "attachment",
        label: { id: "label-1", name: "urgent" },
        isAiMode: false,
      }),
    ).toMatchObject({
      contentType: "attachment",
      labelId: null,
    });
  });

  it("clears the label filter in AI mode", () => {
    expect(
      getSearchFilterPayload({
        spaceId: null,
        contentType: "page",
        label: { id: "label-1", name: "urgent" },
        isAiMode: true,
      }),
    ).toMatchObject({
      contentType: "page",
      labelId: null,
    });
  });
});
