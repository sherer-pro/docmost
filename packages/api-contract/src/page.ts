export const PAGE_CONTENT_FORMATS = ["json", "markdown", "html"] as const;
export type PageContentFormat = (typeof PAGE_CONTENT_FORMATS)[number];

export const PAGE_CONTENT_OPERATIONS = [
  "append",
  "prepend",
  "replace",
] as const;
export type PageContentOperation = (typeof PAGE_CONTENT_OPERATIONS)[number];

export interface PageAccessCapabilities {
  canRead: boolean;
  canWrite: boolean;
  canCreateChild: boolean;
  canMoveDeleteShare: boolean;
  canManageAccess: boolean;
}

export interface PageAccessInfo {
  role: "reader" | "writer" | null;
  sources: string[];
  capabilities: PageAccessCapabilities;
  isSystemAccess: boolean;
}

export interface PageReference {
  id: string;
  slugId: string;
  title: string;
  icon: string | null;
}
