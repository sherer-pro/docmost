import { PartialType } from '@nestjs/mapped-types';
import { CreatePageDto, ContentFormat } from './create-page.dto';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PageSettings } from '@docmost/db/types/entity.types';
import {
  PAGE_AI_ROLE_VALUES as SHARED_PAGE_AI_ROLE_VALUES,
  PAGE_CUSTOM_FIELD_STATUS_VALUES as SHARED_PAGE_CUSTOM_FIELD_STATUS_VALUES,
  PAGE_CONTENT_OPERATIONS,
  type PageAiRole,
  type PageCustomFieldStatus,
  type PageContentOperation,
} from '@docmost/api-contract';

export type ContentOperation = PageContentOperation;
export const PAGE_CUSTOM_FIELD_STATUS_VALUES =
  SHARED_PAGE_CUSTOM_FIELD_STATUS_VALUES;
export const PAGE_AI_ROLE_VALUES = SHARED_PAGE_AI_ROLE_VALUES;

export class UpdatePageCustomFieldsDto {
  @IsOptional()
  @IsIn(PAGE_CUSTOM_FIELD_STATUS_VALUES)
  status?: PageCustomFieldStatus | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  stakeholderIds?: string[];

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(PAGE_AI_ROLE_VALUES)
  aiRole?: PageAiRole;
}

export class UpdatePageDto extends PartialType(CreatePageDto) {
  @IsString()
  pageId: string;

  @IsOptional()
  content?: string | object;

  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }) => value?.toLowerCase())
  @IsIn(PAGE_CONTENT_OPERATIONS)
  operation?: ContentOperation;

  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }) => value?.toLowerCase() ?? 'json')
  @IsIn(['json', 'markdown', 'html'])
  format?: ContentFormat;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePageCustomFieldsDto)
  customFields?: UpdatePageCustomFieldsDto;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  headingNumberingEnabled?: boolean | null;

  toSettingsPayload(
    currentSettings: PageSettings | null,
  ): PageSettings | undefined {
    const hasHeadingNumberingOverride =
      typeof this.headingNumberingEnabled !== 'undefined';

    if (!this.customFields && !hasHeadingNumberingOverride) {
      return this.settings;
    }

    const settingsFromDto =
      this.settings && typeof this.settings === 'object' ? this.settings : {};
    const currentHeadingNumbering =
      currentSettings?.headingNumbering &&
      typeof currentSettings.headingNumbering === 'object'
        ? currentSettings.headingNumbering
        : {};
    const dtoHeadingNumbering =
      settingsFromDto.headingNumbering &&
      typeof settingsFromDto.headingNumbering === 'object'
        ? settingsFromDto.headingNumbering
        : {};

    return {
      ...(currentSettings ?? {}),
      ...settingsFromDto,
      ...(this.customFields ?? {}),
      ...(hasHeadingNumberingOverride
        ? {
            headingNumbering: {
              ...currentHeadingNumbering,
              ...dtoHeadingNumbering,
              enabled: this.headingNumberingEnabled,
            },
          }
        : {}),
    };
  }
}
