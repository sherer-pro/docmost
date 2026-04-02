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
