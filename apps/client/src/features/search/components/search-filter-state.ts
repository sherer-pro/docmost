export interface SelectedSearchLabel {
  id: string;
  name: string;
}

export interface SearchFilterPayload {
  spaceId?: string | null;
  contentType?: string | null;
  labelId?: string | null;
  tag?: "tbd" | "todo" | null;
}

interface SearchFilterPayloadInput {
  spaceId: string | null;
  contentType: string | null;
  label: SelectedSearchLabel | null;
  tag: "tbd" | "todo" | null;
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
