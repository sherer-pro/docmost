import { PartialType } from '@nestjs/mapped-types';
import { CreatePageDto, ContentFormat } from './create-page.dto';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PageSettings } from '@docmost/db/types/entity.types';

export type ContentOperation = 'append' | 'prepend' | 'replace';

export const PAGE_CUSTOM_FIELD_STATUS_VALUES = [
  'not_started',
  'in_progress',
  'done',
] as const;

export class UpdatePageCustomFieldsDto {
  @IsOptional()
  @IsIn(PAGE_CUSTOM_FIELD_STATUS_VALUES)
  status?: (typeof PAGE_CUSTOM_FIELD_STATUS_VALUES)[number] | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  stakeholderIds?: string[];
}

export class UpdatePageDto extends PartialType(CreatePageDto) {
  @IsString()
  pageId: string;

  @IsOptional()
  content?: string | object;

  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }) => value?.toLowerCase())
  @IsIn(['append', 'prepend', 'replace'])
  operation?: ContentOperation;

  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }) => value?.toLowerCase() ?? 'json')
  @IsIn(['json', 'markdown', 'html'])
  format?: ContentFormat;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePageCustomFieldsDto)
  customFields?: UpdatePageCustomFieldsDto;

  toSettingsPayload(currentSettings: PageSettings | null): PageSettings | undefined {
    if (!this.customFields) {
      return this.settings;
    }

    const settingsFromDto = this.settings && typeof this.settings === 'object' ? this.settings : {};
    return {
      ...(currentSettings ?? {}),
      ...settingsFromDto,
      ...this.customFields,
    };
  }
}
