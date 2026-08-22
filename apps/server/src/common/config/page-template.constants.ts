export const PAGE_TEMPLATE_ACTIONS = [
  'create_template',
  'manage_template',
  'use_regular_template',
  'use_synced_template',
] as const;

export type PageTemplateAction = (typeof PAGE_TEMPLATE_ACTIONS)[number];
