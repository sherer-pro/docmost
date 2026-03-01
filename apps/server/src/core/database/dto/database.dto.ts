import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * DTO для создания базы данных внутри пространства.
 */
export class CreateDatabaseDto {
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  icon?: string;
}

/**
 * DTO для обновления метаданных базы данных.
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

  @IsOptional()
  @IsString()
  @MaxLength(255)
  icon?: string;
}

/**
 * DTO query-параметров для фильтрации по пространству.
 */
export class ListDatabasesQueryDto {
  @IsUUID()
  spaceId: string;
}

/**
 * DTO для создания свойства (колонки) в базе данных.
 */
export class CreateDatabasePropertyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  type: string;

  @IsOptional()
  settings?: unknown;
}

/**
 * DTO для обновления свойства базы данных.
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
  type?: string;

  @IsOptional()
  settings?: unknown;
}

/**
 * DTO для создания новой строки базы данных.
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
 * DTO одного значения ячейки при батч-обновлении.
 */
export class BatchUpdateDatabaseCellValueDto {
  @IsUUID()
  propertyId: string;

  @IsOptional()
  value?: unknown;

  @IsOptional()
  @IsUUID()
  attachmentId?: string;

  @IsOptional()
  @IsIn(['upsert', 'delete'])
  operation?: 'upsert' | 'delete';
}

/**
 * DTO для батч-обновления ячеек строки.
 */
export class BatchUpdateDatabaseCellsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateDatabaseCellValueDto)
  cells: BatchUpdateDatabaseCellValueDto[];
}

/**
 * DTO для создания нового представления базы данных.
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
 * DTO для обновления представления базы данных.
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
