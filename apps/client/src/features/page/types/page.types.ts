import { ISpace } from "@/features/space/types/space.types.ts";
import {
  DEFAULT_PAGE_AI_ROLE,
  PAGE_AI_ROLE,
  PAGE_CUSTOM_FIELD_STATUS,
  type PageAiRole as ApiPageAiRole,
  type PageCustomFieldStatus as ApiPageCustomFieldStatus,
  type PageAccessCapabilities as ApiPageAccessCapabilities,
  type PageAccessInfo as ApiPageAccessInfo,
  type PageContentFormat,
  type PageContentOperation,
} from "@docmost/api-contract";

/**
 * Page settings stored in `pages.settings`.
 *
 * `fullPageWidth` is kept only for legacy compatibility and should not be
 * used as a source of truth in client layout logic.
 * The remaining keys are reserved for expandable document fields.
 */
export interface PageSettings {
  fullPageWidth?: boolean;
  [key: string]: unknown;
}

export type PageAccessCapabilities = ApiPageAccessCapabilities;

export type PageAccessInfo = ApiPageAccessInfo;

export interface IPage {
  id: string;
  slugId: string;
  title: string;
  content: string;
  icon: string;
  coverPhoto: string;
  parentPageId: string;
  creatorId: string;
  spaceId: string;
  workspaceId: string;
  isLocked: boolean;
  lastUpdatedById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;
  position: string;
  hasChildren: boolean;
  creator: ICreator;
  lastUpdatedBy: ILastUpdatedBy;
  deletedBy: IDeletedBy;
  customFields?: PageCustomFields;
  settings?: PageSettings;
  databaseId?: string | null;
  access?: PageAccessInfo;
  space: Partial<ISpace>;
}

export const PageCustomFieldStatus = PAGE_CUSTOM_FIELD_STATUS;
export type PageCustomFieldStatus = ApiPageCustomFieldStatus;
export const PageAiRole = PAGE_AI_ROLE;
export type PageAiRole = ApiPageAiRole;
export const DefaultPageAiRole = DEFAULT_PAGE_AI_ROLE;

export interface PageCustomFields {
  status?: PageCustomFieldStatus | null;
  assigneeId?: string | null;
  stakeholderIds?: string[];
  aiRole: PageAiRole;
}

interface ICreator {
  id: string;
  name: string;
  avatarUrl: string;
}
interface ILastUpdatedBy {
  id: string;
  name: string;
  avatarUrl: string;
}

interface IDeletedBy {
  id: string;
  name: string;
  avatarUrl: string;
}

export interface IMovePage {
  pageId: string;
  position?: string;
  after?: string;
  before?: string;
  parentPageId?: string;
}

export interface IMovePageToSpace {
  pageId: string;
  spaceId: string;
}

export interface ICopyPageToSpace {
  pageId: string;
  spaceId?: string;
}

export type SidebarNodeType = "page" | "database" | "databaseRow";

/**
 * Unified node contract for sidebar tree.
 *
 * nodeType determines the routing and set of actions in the context menu.
 */
export interface ISidebarNode {
  id: string;
  nodeType: SidebarNodeType;
  title: string;
  icon: string | null;
  position: string;
  spaceId: string;
  parentPageId: string | null;
  hasChildren: boolean;
  slugId?: string | null;
  databaseId?: string | null;
  customFields?: PageCustomFields | null;
  access?: PageAccessInfo;
}

export interface SidebarPagesParams {
  spaceId?: string;
  pageId?: string;
  cursor?: string;
  includeNodeTypes?: SidebarNodeType[];
}

export interface PageAccessUserEntry {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  type: "user";
  access: PageAccessInfo & {
    canClose: boolean;
  };
}

export interface PageAccessGroupRuleEntry {
  id: string;
  name: string;
  effect: "allow" | "deny";
  role: "reader" | "writer" | null;
  sourcePageId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PageAccessResolvedUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  type: "user";
}

export interface IPageInput {
  pageId: string;
  title: string;
  parentPageId: string;
  icon: string;
  coverPhoto: string;
  position: string;
  isLocked: boolean;
  customFields?: PageCustomFields;
  settings?: PageSettings;
}

export type IUpdatePageInput = Partial<IPageInput> & {
  content?: Record<string, unknown> | string;
  operation?: PageContentOperation;
  format?: PageContentFormat;
};

export interface IExportPageParams {
  pageId: string;
  format: ExportFormat;
  includeChildren?: boolean;
  includeAttachments?: boolean;
}

export enum ExportFormat {
  Docmost = "docmost",
  HTML = "html",
  Markdown = "markdown",
  PDF = "pdf",
}
