export interface SelectedSearchLabel {
  id: string;
  name: string;
}

export interface SearchFilterPayload {
  spaceId?: string | null;
  contentType?: string | null;
  labelId?: string | null;
}

interface SearchFilterPayloadInput {
  spaceId: string | null;
  contentType: string | null;
  label: SelectedSearchLabel | null;
  isAiMode: boolean;
}

export function getSearchFilterPayload({
  spaceId,
  contentType,
  label,
  isAiMode,
}: SearchFilterPayloadInput): SearchFilterPayload {
  return {
    spaceId,
    contentType,
    labelId:
      contentType === "attachment" || isAiMode ? null : label?.id ?? null,
  };
}
