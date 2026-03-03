import { ISpace } from "@/features/space/types/space.types.ts";

/**
 * Page settings stored in `pages.settings`.
 *
 * `fullPageWidth` is used for local page width mode,
 * the remaining keys are reserved for expandable document fields.
 */
export interface PageSettings {
  fullPageWidth?: boolean;
  [key: string]: unknown;
}

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
  space: Partial<ISpace>;
}

export enum PageCustomFieldStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
  REJECTED = 'REJECTED',
  ARCHIVED = 'ARCHIVED',
}

export interface PageCustomFields {
  status?: PageCustomFieldStatus | null;
  assigneeId?: string | null;
  stakeholderIds?: string[];
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


export type SidebarNodeType = 'page' | 'database' | 'databaseRow';

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
}

export interface SidebarPagesParams {
  spaceId?: string;
  pageId?: string;
  cursor?: string;
  includeNodeTypes?: SidebarNodeType[];
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

export interface IExportPageParams {
  pageId: string;
  format: ExportFormat;
  includeChildren?: boolean;
  includeAttachments?: boolean;
}

export enum ExportFormat {
  HTML = "html",
  Markdown = "markdown",
}
