import type { SpacePolicyValues } from "./space-policy";

export type SpaceArchiveFilter = "active" | "archived" | "all";

export interface SpaceAdministrationQuery {
  query?: string;
  status?: SpaceArchiveFilter;
  cursor?: string;
  beforeCursor?: string;
  limit?: number;
}

export interface SpaceAdministrationItem {
  id: string;
  slug: string;
  name: string;
  archivedAt: string | null;
  requiresStepUp: boolean;
  canManage: boolean;
  description?: string | null;
  logo?: string | null;
  memberCount?: number;
  access?: SpacePolicyValues;
  features?: {
    templates: "enabled" | "disabled" | "server_disabled";
    dictionary: boolean;
    ai: "enabled" | "disabled" | "not_configured";
  };
}

export interface SpaceAdministrationResponse {
  items: SpaceAdministrationItem[];
  meta: {
    limit: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
  };
}
