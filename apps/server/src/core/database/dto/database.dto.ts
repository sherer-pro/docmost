import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import {
  DATABASE_PROPERTY_TYPES,
  type DatabasePropertyType,
} from '@docmost/api-contract';
import { JsonValue } from '../../../database/types/db';

const MAX_SELECT_PROPERTY_OPTIONS = 100;
const MAX_DATABASE_BATCH_CELLS = 200;
const MAX_DATABASE_BATCH_ROWS = 200;
const MAX_DATABASE_CELL_VALUE_BYTES = 20_000;
const MAX_DATABASE_VIEW_CONFIG_BYTES = 50_000;
const MAX_DATABASE_VIEW_CONFIG_DEPTH = 12;

function getJsonStringifiedLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function exceedsJsonDepth(value: unknown, maxDepth: number): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (current.depth > maxDepth) {
      return true;
    }

    if (current.value === null || typeof current.value !== 'object') {
      continue;
    }

    const nextDepth = current.depth + 1;
    if (nextDepth > maxDepth) {
      return true;
    }

    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);

    for (const child of children) {
      stack.push({ value: child, depth: nextDepth });
    }
  }

  return false;
}

function MaxJsonStringifiedLength(
  maxBytes: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxJsonStringifiedLength',
      target: object.constructor,
      propertyName,
      constraints: [maxBytes],
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value === 'undefined') {
            return true;
          }

          return getJsonStringifiedLength(value) <= maxBytes;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} JSON payload must not exceed ${args.constraints[0]} bytes`;
        },
      },
    });
  };
}

function MaxJsonDepth(
  maxDepth: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxJsonDepth',
      target: object.constructor,
      propertyName,
      constraints: [maxDepth],
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value === 'undefined') {
            return true;
          }

          return !exceedsJsonDepth(value, maxDepth);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} JSON depth must not exceed ${args.constraints[0]}`;
        },
      },
    });
  };
}

export enum DatabaseExportFormat {
  Markdown = 'markdown',
  HTML = 'html',
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

export class ListDatabaseRowsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;

  @IsOptional()
  @IsIn(['position', 'title'])
  sortField?: 'position' | 'title';

  @IsOptional()
  @IsUUID()
  sortPropertyId?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  filters?: string;
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
  @ArrayMaxSize(MAX_SELECT_PROPERTY_OPTIONS)
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

/**
 * DTO to rename an existing database row.
 */
export class UpdateDatabaseRowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;
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
  @MaxJsonStringifiedLength(MAX_DATABASE_CELL_VALUE_BYTES)
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
  @ArrayMaxSize(MAX_DATABASE_BATCH_CELLS)
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateDatabaseCellValueDto)
  cells: BatchUpdateDatabaseCellValueDto[];
}

export class BatchUpdateDatabaseRowDto {
  @IsUUID()
  pageId: string;

  @IsOptional()
  @IsIn(['upsert_cells', 'delete_row'])
  operation?: 'upsert_cells' | 'delete_row';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DATABASE_BATCH_CELLS)
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateDatabaseCellValueDto)
  cells?: BatchUpdateDatabaseCellValueDto[];
}

export class BatchUpdateDatabaseRowsDto {
  @IsArray()
  @ArrayMaxSize(MAX_DATABASE_BATCH_ROWS)
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateDatabaseRowDto)
  rows: BatchUpdateDatabaseRowDto[];
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
  @MaxJsonStringifiedLength(MAX_DATABASE_VIEW_CONFIG_BYTES)
  @MaxJsonDepth(MAX_DATABASE_VIEW_CONFIG_DEPTH)
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
  @MaxJsonStringifiedLength(MAX_DATABASE_VIEW_CONFIG_BYTES)
  @MaxJsonDepth(MAX_DATABASE_VIEW_CONFIG_DEPTH)
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
  @IsIn(['markdown', 'html', 'pdf'])
  format: DatabaseExportFormat;

  @IsOptional()
  @IsBoolean()
  includeChildren?: boolean;

  @IsOptional()
  @IsBoolean()
  includeAttachments?: boolean;
}
