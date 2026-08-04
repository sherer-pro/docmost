import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class LookupReferenceDto {
  @IsOptional()
  @IsIn(['block', 'page'])
  kind?: 'block' | 'page';

  @IsUUID()
  sourcePageId!: string;

  @ValidateIf((value) => (value.kind ?? 'block') === 'block')
  @IsString()
  @MaxLength(36)
  transclusionId?: string;
}

export class LookupDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LookupReferenceDto)
  references!: LookupReferenceDto[];

  @IsOptional()
  @IsUUID()
  referencePageId?: string;
}
