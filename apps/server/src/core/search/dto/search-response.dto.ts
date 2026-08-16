import { Space } from '@docmost/db/types/entity.types';

export class SearchBreadcrumbDto {
  id: string;
  title: string;
}

export class SearchLabelDto {
  id: string;
  name: string;
  spaceId: string;
  type: string;
}

export type SearchContentKind = 'page' | 'database' | 'databaseRow';

export class SearchTagMatchDto {
  start: number;
  end: number;
  value: string;
}

export class SearchTagSnippetDto {
  anchorId?: string;
  text: string;
  matches: SearchTagMatchDto[];
}

export class SearchTagFacetDto {
  value: 'tbd' | 'todo' | 'done';
  documentCount: number;
}

export class SearchResponseDto {
  id: string;
  slugId: string;
  title: string;
  icon: string;
  parentPageId: string;
  databaseId?: string | null;
  contentKind: SearchContentKind;
  creatorId: string;
  rank: number;
  highlight: string;
  tagMatchCount: number;
  tagSnippets: SearchTagSnippetDto[];
  createdAt: Date;
  updatedAt: Date;
  breadcrumbs?: SearchBreadcrumbDto[];
  labels?: SearchLabelDto[];
  space: Partial<Space>;
}

export class AttachmentSearchResponseDto {
  id: string;
  fileName: string;
  pageId: string;
  creatorId: string;
  rank: number;
  highlight: string;
  createdAt: Date;
  updatedAt: Date;
  space: {
    id: string;
    name: string;
    slug: string;
    icon: string | null;
  };
  page: {
    id: string;
    title: string | null;
    slugId: string;
  };
}
