import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const MAX_DICTIONARY_IMPORT_TERMS = 1000;

export class ListDictionaryTermsQueryDto {
  @IsUUID()
  spaceId: string;
}

export class CreateDictionaryTermDto {
  @IsUUID()
  spaceId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  term: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  forms?: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  definitionMarkdown: string;
}

export class UpdateDictionaryTermDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  term?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  forms?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  definitionMarkdown?: string;
}

export class DictionaryImportTermDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  term: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  forms?: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  definitionMarkdown: string;
}

export class ExportDictionaryTermsDto {
  @IsUUID()
  spaceId: string;
}

export class ImportDictionaryTermsDto {
  @IsUUID()
  spaceId: string;

  @IsArray()
  @ArrayMaxSize(MAX_DICTIONARY_IMPORT_TERMS)
  @ValidateNested({ each: true })
  @Type(() => DictionaryImportTermDto)
  terms: DictionaryImportTermDto[];
}

export class GenerateDictionaryWordFormsDto {
  @IsUUID()
  spaceId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  term: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  forms?: string[];
}

export class GenerateAllDictionaryWordFormsDto {
  @IsUUID()
  spaceId: string;
}
