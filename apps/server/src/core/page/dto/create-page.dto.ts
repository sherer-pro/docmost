import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PageSettings } from '@docmost/db/types/entity.types';
import {
  PAGE_CONTENT_FORMATS,
  type PageContentFormat,
} from '@docmost/api-contract';

export type ContentFormat = PageContentFormat;

export class CreatePageDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  parentPageId?: string;

  @IsUUID()
  spaceId: string;

  @IsOptional()
  content?: string | object;

  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }) => value?.toLowerCase() ?? 'json')
  @IsIn(PAGE_CONTENT_FORMATS)
  format?: ContentFormat;

  /**
   * Flexible document metadata (status, assigneeId, stakeholderIds, and future fields).
   */
  @IsOptional()
  @IsObject()
  settings?: PageSettings;
}
