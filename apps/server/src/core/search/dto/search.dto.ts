import {
  ArrayMaxSize,
  ArrayUnique,
  Max,
  MaxLength,
  Min,
  IsBoolean,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

function parseOptionalBoolean(value: unknown): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  return value;
}

export const BUILT_IN_SEARCH_TAGS = ['tbd', 'todo', 'done'] as const;
export type BuiltInSearchTag = (typeof BUILT_IN_SEARCH_TAGS)[number];

function hasDocumentFilter(dto: SearchDTO): boolean {
  return Boolean(dto.labelId || dto.tag || dto.tags?.length);
}

export class SearchDTO {
  @ValidateIf((dto: SearchDTO) =>
    typeof dto.query === 'string'
      ? dto.query.trim().length > 0 || !hasDocumentFilter(dto)
      : !hasDocumentFilter(dto),
  )
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(512)
  query?: string;

  @IsOptional()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsString()
  shareId?: string;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsOptional()
  @IsUUID()
  labelId?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{0,31}$/)
  tag?: string;

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((tag) =>
          typeof tag === 'string' ? tag.trim().toLowerCase() : tag,
        )
      : value,
  )
  @IsArray()
  @ArrayMaxSize(BUILT_IN_SEARCH_TAGS.length)
  @ArrayUnique()
  @IsIn(BUILT_IN_SEARCH_TAGS, { each: true })
  tags?: BuiltInSearchTag[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  offset?: number;
}

export class SearchShareDTO extends SearchDTO {
  @IsNotEmpty()
  @IsString()
  shareId: string;

  @IsOptional()
  @IsUUID()
  spaceId: string;
}

export class SearchTagFacetDTO {
  @IsOptional()
  @IsUUID()
  spaceId?: string;
}

export class SearchSuggestionDTO {
  @IsNotEmpty()
  @IsString()
  @MaxLength(512)
  query: string;

  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  includeUsers?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  includeGroups?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  includePages?: boolean;

  @IsOptional()
  @IsString()
  spaceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;
}
