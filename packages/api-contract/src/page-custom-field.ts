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

export const PAGE_AI_ROLE = {
  NONE: 'NONE',
  EDITOR: 'EDITOR',
  COAUTHOR: 'COAUTHOR',
  COAUTHOR_PLUS: 'COAUTHOR_PLUS',
  AUTHOR: 'AUTHOR',
} as const;

export type PageAiRole = (typeof PAGE_AI_ROLE)[keyof typeof PAGE_AI_ROLE];

export const PAGE_AI_ROLE_VALUES = Object.values(PAGE_AI_ROLE) as PageAiRole[];

export const DEFAULT_PAGE_AI_ROLE = PAGE_AI_ROLE.NONE;
