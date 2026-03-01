import { Type } from 'class-transformer';
import {
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

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  icon?: string;
}

/**
 * DTO для выбора баз данных пространства.
 */
export class ListDatabasesDto {
  @IsUUID()
  spaceId: string;
}

/**
 * DTO для фильтрации строк базы данных.
 */
export class ListDatabaseRowsDto {
  @IsUUID()
  databaseId: string;
}

/**
 * DTO одного значения ячейки.
 */
export class UpsertDatabaseCellValueDto {
  @IsUUID()
  propertyId: string;

  @IsOptional()
  value?: unknown;
}

/**
 * DTO для массового upsert ячеек в строке.
 */
export class UpsertDatabaseRowCellsDto {
  @IsUUID()
  databaseId: string;

  @IsUUID()
  pageId: string;

  @ValidateNested({ each: true })
  @Type(() => UpsertDatabaseCellValueDto)
  cells: UpsertDatabaseCellValueDto[];
}
