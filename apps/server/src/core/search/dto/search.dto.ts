import {
  Max,
  MaxLength,
  Min,
  IsBoolean,
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

export class SearchDTO {
  @ValidateIf((dto: SearchDTO) =>
    typeof dto.query === 'string'
      ? dto.query.trim().length > 0 || (!dto.labelId && !dto.tag)
      : !dto.labelId && !dto.tag,
  )
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
