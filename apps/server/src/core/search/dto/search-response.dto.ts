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

export class SearchDatabaseMatchDto {
  propertyId: string;
  propertyName: string;
  text: string;
  matches: SearchTagMatchDto[];
}

export class SearchTagSnippetDto {
  anchorId?: string;
  text: string;
  matches: SearchTagMatchDto[];
}

export class SearchTagFacetDto {
  value: BuiltInTagValue;
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
  databaseMatches?: SearchDatabaseMatchDto[];
  createdAt: Date;
  updatedAt: Date;
  breadcrumbs?: SearchBreadcrumbDto[];
  labels?: SearchLabelDto[];
  space: Partial<Space>;
}

export type DictionarySearchMatchedField = 'term' | 'form' | 'definition';

export class DictionarySearchResponseDto {
  id: string;
  term: string;
  matchedField: DictionarySearchMatchedField;
  matchedForm?: string;
  snippet: {
    text: string;
    matches: SearchTagMatchDto[];
  };
  definitionSnippet: {
    text: string;
    matches: SearchTagMatchDto[];
  };
  rank: number;
  space: {
    id: string;
    name: string;
    slug: string;
    icon: string | null;
  };
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
import type { BuiltInTagValue } from '@docmost/editor-ext/server';
