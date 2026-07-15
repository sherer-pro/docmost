import { describe, expect, it } from "vitest";
import {
  getUnifiedSearchBackendParams,
  getUnifiedSearchType,
  isUnifiedSearchEnabled,
} from "./use-unified-search";

describe("getUnifiedSearchType", () => {
  it("routes attachment content type to attachment search", () => {
    expect(getUnifiedSearchType("attachment")).toBe("attachment");
  });

  it("defaults non-attachment content types to page search", () => {
    expect(getUnifiedSearchType("page")).toBe("page");
    expect(getUnifiedSearchType(undefined)).toBe("page");
  });

  it("enables page search when a label is selected without a text query", () => {
    expect(
      isUnifiedSearchEnabled({
        query: "",
        contentType: "page",
        labelId: "label-1",
      }),
    ).toBe(true);
  });

  it("enables page search when a tag is selected without a text query", () => {
    expect(
      isUnifiedSearchEnabled({
        query: "",
        contentType: "page",
        tag: "done",
      }),
    ).toBe(true);
  });

  it("keeps attachment search disabled without a text query even when labelId exists", () => {
    expect(
      isUnifiedSearchEnabled({
        query: "",
        contentType: "attachment",
        labelId: "label-1",
      }),
    ).toBe(false);
  });

  it("does not send page-only filters to attachment search", () => {
    expect(
      getUnifiedSearchBackendParams({
        query: "report",
        contentType: "attachment",
        labelId: "label-1",
        tag: "done",
        spaceId: "space-1",
      }),
    ).toEqual({
      query: "report",
      spaceId: "space-1",
    });
  });
});
