import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

function parseBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

export class RagListPagesQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value, false))
  @IsBoolean()
  includeContent?: boolean = false;
}

export class RagUpdatesQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  updatedSince: number;
}

export class RagDeletedQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  deletedSince: number;
}

export class RagPageInfoQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value, true))
  @IsBoolean()
  includeContent?: boolean = true;
}

export class RagDatabaseRowsQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }

    return [];
  })
  @IsArray()
  @IsString({ each: true })
  pageIds?: string[] = [];
}

export const RAG_EXPORT_FORMATS = ['markdown', 'html'] as const;
export type RagExportFormat = (typeof RAG_EXPORT_FORMATS)[number];

export class RagPageExportQueryDto {
  @IsOptional()
  @IsIn(RAG_EXPORT_FORMATS)
  format?: RagExportFormat = 'markdown';

  @IsOptional()
  @Transform(({ value }) => parseBoolean(value, true))
  @IsBoolean()
  includeAttachments?: boolean = true;

  @IsOptional()
  @Transform(({ value }) => parseBoolean(value, true))
  @IsBoolean()
  includeChildren?: boolean = true;
}

export class RagSpaceExportQueryDto {
  @IsOptional()
  @IsIn(RAG_EXPORT_FORMATS)
  format?: RagExportFormat = 'markdown';

  @IsOptional()
  @Transform(({ value }) => parseBoolean(value, true))
  @IsBoolean()
  includeAttachments?: boolean = true;
}

export class RagDatabaseIdentifierParamsDto {
  @IsString()
  @IsNotEmpty()
  databaseIdOrPageSlug: string;
}

export class RagPageIdentifierParamsDto {
  @IsString()
  @IsNotEmpty()
  pageIdOrSlug: string;
}
