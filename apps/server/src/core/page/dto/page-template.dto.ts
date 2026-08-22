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
import {
  PAGE_TEMPLATE_ARCHIVE_STATES,
  PAGE_TEMPLATE_DESTINATION_PURPOSES,
  TEMPLATE_KINDS,
  PageTemplateArchiveState,
  PageTemplateDestinationPurpose,
  TemplateKind,
} from '@docmost/api-contract';

export class PageTemplateDiscoveryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsUUID()
  spaceId!: string;

  @IsOptional()
  @IsIn(TEMPLATE_KINDS)
  kind?: TemplateKind;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  includeArchived?: boolean = false;

  @IsOptional()
  @IsIn(PAGE_TEMPLATE_ARCHIVE_STATES)
  archiveState?: PageTemplateArchiveState;

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
  @IsUUID()
  pageId?: string;

  @IsOptional()
  @IsIn(PAGE_TEMPLATE_DESTINATION_PURPOSES)
  purpose?: PageTemplateDestinationPurpose = 'destination';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

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

export class PageTemplatePaginationDto {
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

export class PageTemplatePolicyGroupsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

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

export class CreatePageTemplateDto {
  @IsUUID()
  spaceId!: string;

  @IsIn(TEMPLATE_KINDS)
  kind!: TemplateKind;

  @IsOptional()
  @IsUUID()
  sourcePageId?: string;

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

export class CreateIndependentPageCopyDto {
  @IsOptional()
  @IsUUID()
  parentPageId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;
}

export class PublishPageTemplateDto {
  @IsString()
  @Length(64, 64)
  draftHash!: string;

  @IsOptional()
  @IsUUID()
  confirmationToken?: string;
}

export class DetachSyncedTemplateDto {
  @IsBoolean()
  confirmed!: boolean;

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
  allowRegularTemplate!: boolean;

  @IsBoolean()
  allowSyncedTemplate!: boolean;

  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class PageTemplateGroupPolicyDto {
  @IsOptional()
  @IsArray()
  @IsIn(
    [
      'create_template',
      'manage_template',
      'use_regular_template',
      'use_synced_template',
    ],
    { each: true },
  )
  allowedActions?: string[] | null;

  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
