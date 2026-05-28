import { Space } from '@docmost/db/types/entity.types';

export class SearchBreadcrumbDto {
  id: string;
  title: string;
}

export class SearchResponseDto {
  id: string;
  title: string;
  icon: string;
  parentPageId: string;
  databaseId?: string | null;
  creatorId: string;
  rank: number;
  highlight: string;
  createdAt: Date;
  updatedAt: Date;
  breadcrumbs?: SearchBreadcrumbDto[];
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
