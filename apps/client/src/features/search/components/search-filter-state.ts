import type { TagValue } from "@docmost/editor-ext";

export interface SelectedSearchLabel {
  id: string;
  name: string;
}

export interface SearchFilterPayload {
  spaceId?: string | null;
  contentType?: string | null;
  labelId?: string | null;
  tag?: TagValue | null;
}

interface SearchFilterPayloadInput {
  spaceId: string | null;
  contentType: string | null;
  label: SelectedSearchLabel | null;
  tag: TagValue | null;
  isAiMode: boolean;
}

export function getSearchFilterPayload({
  spaceId,
  contentType,
  label,
  tag,
  isAiMode,
}: SearchFilterPayloadInput): SearchFilterPayload {
  const supportsPageFilters = contentType !== "attachment" && !isAiMode;

  return {
    spaceId,
    contentType,
    labelId: supportsPageFilters ? (label?.id ?? null) : null,
    tag: supportsPageFilters ? tag : null,
  };
}
