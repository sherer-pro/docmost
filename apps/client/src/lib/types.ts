import {
  ApiResponseEnvelope,
  UnwrappedApiResponse,
} from '@docmost/api-contract';

export interface QueryParams {
  query?: string;
  cursor?: string;
  beforeCursor?: string;
  limit?: number;
  adminView?: boolean;
}

export enum UserRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

export enum SpaceRole {
  ADMIN = 'admin',
  WRITER = 'writer',
  READER = 'reader',
}

export interface IRoleData {
  label: string;
  value: string;
  description: string;
}

/**
 * Full backend payload before client-side unwrap in the axios response interceptor.
 */
export type ApiResponse<T> = ApiResponseEnvelope<T>;

/**
 * Utility type for places where axios already returns only `data`.
 */
export type ApiUnwrappedResponse<T> = UnwrappedApiResponse<T>;

export type IPaginationMeta = {
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
};

export type IPagination<T> = {
  items: T[];
  meta: IPaginationMeta;
};
