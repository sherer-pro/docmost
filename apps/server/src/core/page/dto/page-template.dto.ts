import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SetPageTemplateDto {
  @IsBoolean()
  enabled!: boolean;
}

export class PageTemplateDiscoveryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsUUID()
  spaceId!: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class PageTemplateDestinationsDto {
  @IsUUID()
  spaceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class CreatePageTemplateDto {
  @IsUUID()
  spaceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;
}

export class CreateFromTemplateDto {
  @IsUUID()
  templatePageId!: string;

  @IsUUID()
  spaceId!: string;

  @IsOptional()
  @IsUUID()
  parentPageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;
}

export class InsertPageEmbedDto {
  @IsUUID()
  consumerPageId!: string;

  @IsUUID()
  sourcePageId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  from!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  to!: number;

  @IsString()
  @Length(64, 64)
  baseContentHash!: string;
}

export class DetachPageEmbedDto {
  @IsUUID()
  consumerPageId!: string;

  @IsUUID()
  referenceNodeId!: string;

  @IsString()
  @Length(64, 64)
  baseContentHash!: string;
}

export class PageTemplateWorkspacePolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class PageTemplateSpacePolicyDto {
  @IsBoolean()
  templatesEnabled!: boolean;

  @IsBoolean()
  allowCreateTemplate!: boolean;

  @IsBoolean()
  allowSnapshot!: boolean;

  @IsBoolean()
  allowLiveEmbed!: boolean;

  @IsBoolean()
  allowPublicLiveEmbed!: boolean;

  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class PageTemplateGroupPolicyDto {
  @IsOptional()
  @IsArray()
  @IsIn(
    ['create_template', 'manage_template', 'use_snapshot', 'use_live_embed'],
    { each: true },
  )
  allowedActions?: string[] | null;

  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
