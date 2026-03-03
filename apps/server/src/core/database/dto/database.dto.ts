import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { DatabasePropertyType } from '@docmost/api-contract';
import { JsonValue } from '../../../database/types/db';

const DATABASE_PROPERTY_TYPES: DatabasePropertyType[] = [
  'multiline_text',
  'checkbox',
  'code',
  'select',
  'user',
  'page_reference',
];

export enum DatabaseExportFormat {
  Markdown = 'markdown',
  PDF = 'pdf',
}

/**
 * DTO for creating a database within a space.
 */
export class CreateDatabaseDto {
  @IsUUID()
  spaceId: string;

  /**
   * ID of the parent page in the tree.
   *
   * If passed, the database node will be created as a child of this page.
   * If not passed, the base is created at the root of the space.
   */
  @IsOptional()
  @IsUUID()
  parentPageId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Rich-text description content in JSON format (Tiptap/ProseMirror).
   */
  @IsOptional()
  descriptionContent?: JsonValue;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  icon?: string;
}

/**
 * DTO for updating database metadata.
 */
export class UpdateDatabaseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Rich-text description content in JSON format (Tiptap/ProseMirror).
   */
  @IsOptional()
  descriptionContent?: JsonValue;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  icon?: string;
}

/**
 * DTO query parameters for filtering by space.
 */
export class ListDatabasesQueryDto {
  @IsUUID()
  spaceId: string;
}

export class SelectPropertyOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  value: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string;
}

export class SelectPropertySettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectPropertyOptionDto)
  options: SelectPropertyOptionDto[];
}

/**
 * DTO for creating a property (column) in the database.
 */
export class CreateDatabasePropertyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @IsIn(DATABASE_PROPERTY_TYPES)
  type: DatabasePropertyType;

  @IsOptional()
  @ValidateIf((_, value) => typeof value !== 'undefined')
  @ValidateNested()
  @Type(() => SelectPropertySettingsDto)
  settings?: SelectPropertySettingsDto;
}

/**
 * DTO for updating a database property.
 */
export class UpdateDatabasePropertyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @IsIn(DATABASE_PROPERTY_TYPES)
  type?: DatabasePropertyType;

  @IsOptional()
  @ValidateIf((_, value) => typeof value !== 'undefined')
  @ValidateNested()
  @Type(() => SelectPropertySettingsDto)
  settings?: SelectPropertySettingsDto;
}

/**
 * DTO to create a new database row.
 */
export class CreateDatabaseRowDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  icon?: string;

  @IsOptional()
  @IsUUID()
  parentPageId?: string;
}


export class DatabaseUserCellValueDto {
  @IsUUID()
  id: string;
}

/**
 * DTO of one cell value during batch update.
 */
export class BatchUpdateDatabaseCellValueDto {
  @IsUUID()
  propertyId: string;

  @IsOptional()
  value?: string | boolean | DatabaseUserCellValueDto | null;

  @IsOptional()
  @IsUUID()
  attachmentId?: string;

  @IsOptional()
  @IsIn(['upsert', 'delete'])
  operation?: 'upsert' | 'delete';
}

/**
 * DTO for batch updating row cells.
 */
export class BatchUpdateDatabaseCellsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateDatabaseCellValueDto)
  cells: BatchUpdateDatabaseCellValueDto[];
}

/**
 * DTO to create a new database view.
 */
export class CreateDatabaseViewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  type: string;

  @IsOptional()
  config?: unknown;
}

/**
 * DTO for updating the database view.
 */
export class UpdateDatabaseViewDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  type?: string;

  @IsOptional()
  config?: unknown;
}


export class DatabaseRowPageIdDto {
  @IsUUID()
  pageId: string;
}

/**
 * DTO for exporting a database to a file.
 */
export class ExportDatabaseDto {
  @IsString()
  @IsIn(['markdown', 'pdf'])
  format: DatabaseExportFormat;
}
