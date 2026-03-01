import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
export const sidebarNodeTypes = ['page', 'database', 'databaseRow'] as const;
export type SidebarNodeType = (typeof sidebarNodeTypes)[number];

export class SidebarPageDto {
  @IsOptional()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsString()
  pageId: string;

  @IsOptional()
  @IsArray()
  @IsIn(sidebarNodeTypes, { each: true })
  includeNodeTypes?: SidebarNodeType[];
}
