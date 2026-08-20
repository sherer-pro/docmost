import { PartialType } from '@nestjs/mapped-types';
import { CreateSpaceDto } from './create-space.dto';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  builtInTagValues,
  type BuiltInTagValue,
} from '@docmost/editor-ext/server';

/**
 * Allowed icon identifiers for space custom links.
 *
 * Keep this list in sync with the client icon registry at
 * apps/client/src/features/space/components/custom-links/custom-link-icons.ts
 */
export const SPACE_CUSTOM_LINK_ICONS = [
  'link',
  'external-link',
  'world',
  'world-www',
  'book',
  'book2',
  'notebook',
  'file',
  'file-text',
  'files',
  'folder',
  'folders',
  'star',
  'home',
  'home2',
  'settings',
  'adjustments',
  'tool',
  'tools',
  'users',
  'user',
  'user-circle',
  'calendar',
  'calendar-event',
  'clock',
  'mail',
  'mail-opened',
  'message',
  'message-circle',
  'messages',
  'bell',
  'bookmark',
  'flag',
  'heart',
  'thumb-up',
  'help',
  'help-circle',
  'info-circle',
  'alert-circle',
  'clipboard',
  'clipboard-list',
  'checklist',
  'checkbox',
  'list',
  'list-check',
  'chart-bar',
  'chart-line',
  'chart-pie',
  'chart-dots',
  'database',
  'server',
  'server2',
  'cloud',
  'cloud-upload',
  'code',
  'terminal',
  'terminal2',
  'rocket',
  'bulb',
  'target',
  'trophy',
  'flame',
  'bolt',
  'key',
  'lock',
  'shield',
  'tag',
  'tags',
  'paperclip',
  'pin',
  'map',
  'map-pin',
  'map2',
  'phone',
  'video',
  'camera',
  'photo',
  'music',
  'headphones',
  'download',
  'upload',
  'share',
  'send',
  'search',
  'filter',
  'edit',
  'pencil',
  'briefcase',
  'building',
  'shopping-cart',
  'credit-card',
  'coin',
  'currency-dollar',
  'gift',
  'ticket',
  'presentation',
  'report',
  'news',
  'rss',
  'brand-github',
  'brand-gitlab',
  'brand-slack',
  'brand-figma',
  'brand-google',
  'brand-youtube',
  'brand-x',
  'brand-linkedin',
  'palette',
  'brush',
  'wand',
  'puzzle',
  'atom',
  'flask',
  'microscope',
  'school',
  'certificate',
  'id',
  'notes',
  'note',
  'stack',
  'layout-grid',
  'apps',
  'compass',
  'route',
  'building-store',
  'mood-smile',
  'eye',
  'zoom',
  'hash',
  'at',
] as const;

export const SPACE_CUSTOM_LINKS_MAX = 20;

export class UpdateSpaceCustomLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url: string;

  @IsString()
  @IsIn(SPACE_CUSTOM_LINK_ICONS as unknown as string[])
  icon: string;
}

export class UpdateSpaceCustomLinksDto {
  @IsArray()
  @ArrayMaxSize(SPACE_CUSTOM_LINKS_MAX)
  @ValidateNested({ each: true })
  @Type(() => UpdateSpaceCustomLinkDto)
  links: UpdateSpaceCustomLinkDto[];
}

export class UpdateSpaceDocumentFieldsDto {
  @IsOptional()
  @IsBoolean()
  status?: boolean;

  @IsOptional()
  @IsBoolean()
  assignee?: boolean;

  @IsOptional()
  @IsBoolean()
  stakeholders?: boolean;

  @IsOptional()
  @IsBoolean()
  aiRole?: boolean;

  @IsOptional()
  @IsBoolean()
  readingTime?: boolean;
}

export class UpdateSpaceTagSettingsDto {
  @IsArray()
  @ArrayMaxSize(builtInTagValues.length)
  @ArrayUnique()
  @IsIn(builtInTagValues, { each: true })
  disabled: BuiltInTagValue[];
}

export class UpdateSpaceDto extends PartialType(CreateSpaceDto) {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsBoolean()
  disablePublicSharing?: boolean | null;

  @IsOptional()
  @IsBoolean()
  enforceMfa?: boolean | null;

  @IsOptional()
  @IsBoolean()
  enforceSso?: boolean | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSpaceDocumentFieldsDto)
  documentFields?: UpdateSpaceDocumentFieldsDto;

  @IsOptional()
  @IsBoolean()
  dictionaryEnabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSpaceTagSettingsDto)
  tagSettings?: UpdateSpaceTagSettingsDto;

  @IsOptional()
  @IsBoolean()
  headingNumberingEnabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSpaceCustomLinksDto)
  customLinks?: UpdateSpaceCustomLinksDto;
}
