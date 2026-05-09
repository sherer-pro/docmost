import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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
