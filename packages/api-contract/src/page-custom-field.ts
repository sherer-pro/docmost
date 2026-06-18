export const PAGE_CUSTOM_FIELD_STATUS = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  IN_REVIEW: 'IN_REVIEW',
  DONE: 'DONE',
  REJECTED: 'REJECTED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type PageCustomFieldStatus =
  (typeof PAGE_CUSTOM_FIELD_STATUS)[keyof typeof PAGE_CUSTOM_FIELD_STATUS];

export const PAGE_CUSTOM_FIELD_STATUS_VALUES = Object.values(
  PAGE_CUSTOM_FIELD_STATUS,
) as PageCustomFieldStatus[];
