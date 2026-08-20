import { IUser } from "@/features/user/types/user.types.ts";
import { IGroup } from "@/features/group/types/group.types.ts";
import { ISpace } from "@/features/space/types/space.types.ts";
import { IPage } from "@/features/page/types/page.types.ts";
import type { BuiltInTagValue, TagValue } from "@docmost/editor-ext";

export interface IPageSearchBreadcrumb {
  id: string;
  title: string;
}

export interface IPageSearchLabel {
  id: string;
  name: string;
  spaceId: string;
  type: "page";
}

export interface IPageSearch {
  id: string;
  title: string;
  icon: string;
  parentPageId: string;
  databaseId?: string | null;
  contentKind: "page" | "database" | "databaseRow";
  slugId: string;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
  rank: number;
  highlight: string;
  tagMatchCount: number;
  tagSnippets: ITagSearchSnippet[];
  databaseMatches?: IDatabaseSearchMatch[];
  breadcrumbs?: IPageSearchBreadcrumb[];
  labels?: IPageSearchLabel[];
  space: Partial<ISpace>;
}

interface ITagSearchMatch {
  start: number;
  end: number;
  value: string;
}

export interface IDatabaseSearchMatch {
  propertyId: string;
  propertyName: string;
  text: string;
  matches: ITagSearchMatch[];
}

export interface ITagSearchSnippet {
  anchorId?: string;
  text: string;
  matches: ITagSearchMatch[];
}

export interface ITagSearchFacet {
  value: BuiltInTagValue;
  documentCount: number;
}

export interface SearchSuggestionParams {
  query: string;
  includeUsers?: boolean;
  includeGroups?: boolean;
  includePages?: boolean;
  spaceId?: string;
  limit?: number;
}

export interface ISuggestionResult {
  users?: Partial<IUser[]>;
  groups?: Partial<IGroup[]>;
  pages?: Partial<IPage[]>;
}

export interface IPageSearchParams {
  query: string;
  spaceId?: string;
  shareId?: string;
  labelId?: string;
  tag?: TagValue;
  tags?: BuiltInTagValue[];
  limit?: number;
  offset?: number;
}

export interface IDictionarySearchParams {
  query: string;
  spaceId?: string;
  limit?: number;
  offset?: number;
}

export interface IDictionarySearch {
  id: string;
  term: string;
  matchedField: "term" | "form" | "definition";
  matchedForm?: string;
  snippet: ITagSearchSnippet;
  rank: number;
  space: {
    id: string;
    name: string;
    slug: string;
    icon: string | null;
  };
}

export interface SearchTagFacetParams {
  spaceId?: string;
}

export interface SearchLabelParams {
  query?: string;
  spaceId?: string;
  limit?: number;
}

export interface IAttachmentSearch {
  id: string;
  fileName: string;
  pageId: string;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
  rank: number;
  highlight: string;
  space: {
    id: string;
    name: string;
    slug: string;
    icon: string;
  };
  page: {
    id: string;
    title: string;
    slugId: string;
  };
}
