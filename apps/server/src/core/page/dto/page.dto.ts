import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { ContentFormat } from './create-page.dto';
import { PaginationOptions } from '../../../database/pagination/pagination-options';

function parseOptionalBoolean(value: unknown): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  return value;
}

export class PageIdDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class SpaceIdDto {
  @IsUUID()
  spaceId: string;
}

export class PageHistoryIdDto {
  @IsUUID()
  historyId: string;
}

export class PageInfoDto extends PageIdDto {
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  includeSpace: boolean;

  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  includeContent: boolean;

  @IsOptional()
  @Transform(({ value }) => value?.toLowerCase())
  @IsIn(['json', 'markdown', 'html'])
  format?: ContentFormat;
}

export class DeletePageDto extends PageIdDto {
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  permanentlyDelete?: boolean;
}

export class PageHistoryQueryDto extends PaginationOptions {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class PageLabelsQueryDto extends PaginationOptions {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}
