import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationOptions {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  beforeCursor?: string;

  @IsOptional()
  @IsString()
  query: string;

  @IsOptional()
  @IsBoolean()
  adminView: boolean;

  @IsOptional()
  includeArchived?: boolean | string;
}

export function shouldIncludeArchived(
  pagination?: Pick<PaginationOptions, 'includeArchived'>,
): boolean {
  return (
    pagination?.includeArchived === true ||
    pagination?.includeArchived === 'true'
  );
}
