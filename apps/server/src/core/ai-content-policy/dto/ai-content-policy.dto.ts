import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AiContentExclusionInputDto {
  @IsUUID()
  pageId: string;

  @IsBoolean()
  includeDescendants: boolean;
}

export class UpdateAiContentPolicyDto {
  @IsInt()
  @Min(0)
  expectedRevision: number;

  @IsBoolean()
  ragSearchDoneOnly: boolean;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AiContentExclusionInputDto)
  exclusions: AiContentExclusionInputDto[];
}

export class AiContentPolicyCandidatesQueryDto {
  @IsString()
  @MaxLength(512)
  query: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cursor = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
