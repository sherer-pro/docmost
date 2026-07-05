import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  getSearchLabelsQueryKey,
  getSearchSuggestionQueryKey,
} from "./search-query";

describe("getSearchSuggestionQueryKey", () => {
  it("separates user/group suggestions from page mention suggestions", () => {
    const memberPickerKey = getSearchSuggestionQueryKey({
      query: "Roadmap",
      includeUsers: true,
      includeGroups: true,
    });

    const mentionKey = getSearchSuggestionQueryKey({
      query: "Roadmap",
      includeUsers: true,
      includePages: true,
      spaceId: "space-1",
      limit: 10,
    });

    assert.notDeepEqual(memberPickerKey, mentionKey);
  });

  it("separates page suggestions by space", () => {
    const firstSpaceKey = getSearchSuggestionQueryKey({
      query: "Roadmap",
      includePages: true,
      spaceId: "space-1",
    });

    const secondSpaceKey = getSearchSuggestionQueryKey({
      query: "Roadmap",
      includePages: true,
      spaceId: "space-2",
    });

    assert.notDeepEqual(firstSpaceKey, secondSpaceKey);
  });
});

describe("getSearchLabelsQueryKey", () => {
  it("separates label suggestions by space", () => {
    const firstSpaceKey = getSearchLabelsQueryKey({
      query: "urgent",
      spaceId: "space-1",
    });

    const secondSpaceKey = getSearchLabelsQueryKey({
      query: "urgent",
      spaceId: "space-2",
    });

    assert.notDeepEqual(firstSpaceKey, secondSpaceKey);
  });
});
