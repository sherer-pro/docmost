import type { BuiltInTagValue } from "@docmost/editor-ext";

export interface SelectedSearchLabel {
  id: string;
  name: string;
}

export interface SearchFilterPayload {
  spaceId?: string | null;
  contentType?: string | null;
  labelId?: string | null;
  tags?: BuiltInTagValue[];
}

export function sameSearchTags(
  current: readonly BuiltInTagValue[],
  expected: readonly BuiltInTagValue[],
) {
  return (
    current.length === expected.length &&
    expected.every((tag) => current.includes(tag))
  );
}

export function shouldShowSearchTagFilter({
  disabled,
  selectedTags,
  availableTags,
}: {
  disabled: boolean;
  selectedTags: readonly BuiltInTagValue[];
  availableTags: readonly BuiltInTagValue[];
}) {
  return !disabled && (selectedTags.length > 0 || availableTags.length > 0);
}

export function shouldClearUnavailableSearchTags({
  disabled,
  facetsLoaded,
  selectedTags,
  availableTags,
}: {
  disabled: boolean;
  facetsLoaded: boolean;
  selectedTags: readonly BuiltInTagValue[];
  availableTags: readonly BuiltInTagValue[];
}) {
  return (
    !disabled &&
    facetsLoaded &&
    selectedTags.length > 0 &&
    availableTags.length === 0
  );
}

interface SearchFilterPayloadInput {
  spaceId: string | null;
  contentType: string | null;
  label: SelectedSearchLabel | null;
  tags: BuiltInTagValue[];
}

export function getSearchFilterPayload({
  spaceId,
  contentType,
  label,
  tags,
}: SearchFilterPayloadInput): SearchFilterPayload {
  const supportsPageFilters = contentType !== "attachment";

  return {
    spaceId,
    contentType,
    labelId: supportsPageFilters ? (label?.id ?? null) : null,
    tags: supportsPageFilters ? tags : [],
  };
}
