import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationOptions } from '../../../database/pagination/pagination-options';

export const sidebarNodeTypes = ['page', 'database', 'databaseRow'] as const;
export type SidebarNodeType = (typeof sidebarNodeTypes)[number];

export class SidebarPageDto {
  @IsOptional()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsUUID()
  pageId: string;

  @IsOptional()
  @IsArray()
  @IsIn(sidebarNodeTypes, { each: true })
  includeNodeTypes?: SidebarNodeType[];
}

export class SidebarPagesQueryDto extends PaginationOptions {
  @IsOptional()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsUUID()
  pageId: string;

  @IsOptional()
  @IsArray()
  @IsIn(sidebarNodeTypes, { each: true })
  includeNodeTypes?: SidebarNodeType[];
}
