export const DEFAULT_MAX_PAGE_EMBED_DEPTH = 5;
export const MIN_PAGE_EMBED_DEPTH = 1;
export const MAX_CONFIGURED_PAGE_EMBED_DEPTH = 10;
export const PAGE_EMBED_GRAPH_MAX_NODES = 10_000;
export const PAGE_EMBED_GRAPH_MAX_EDGES = 50_000;

export const PAGE_TEMPLATE_ACTIONS = [
  'create_template',
  'manage_template',
  'use_regular_template',
  'use_synced_template',
] as const;

export type PageTemplateAction = (typeof PAGE_TEMPLATE_ACTIONS)[number];
