import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { RAG_SYNC_ADAPTERS, RagSyncAdapter } from '@docmost/api-contract';

export class RagSyncTargetUpdateDto {
  @IsOptional()
  @IsIn(RAG_SYNC_ADAPTERS)
  adapter?: RagSyncAdapter;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  baseUrl?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_-]+$/)
  knowledgeId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  writerApiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearWriterApiKey?: boolean;
}

export class UpdateRagSyncSpaceConfigDto {
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  expectedVersion: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => RagSyncTargetUpdateDto)
  target?: RagSyncTargetUpdateDto;
}

export class RagSyncActionDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;
}

export class RagSyncDestructiveActionDto extends RagSyncActionDto {
  @IsBoolean()
  confirm: boolean;
}
