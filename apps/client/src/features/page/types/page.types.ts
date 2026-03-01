import { ISpace } from "@/features/space/types/space.types.ts";

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
 * Унифицированный контракт узла для sidebar-дерева.
 *
 * nodeType определяет роутинг и набор действий в контекстном меню.
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
