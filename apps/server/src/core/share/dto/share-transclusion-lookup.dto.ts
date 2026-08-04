import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

export class ShareTransclusionReferenceDto {
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

export class ShareTransclusionLookupDto {
  @IsString()
  @IsNotEmpty()
  shareId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ShareTransclusionReferenceDto)
  references!: ShareTransclusionReferenceDto[];

  @IsOptional()
  @IsUUID()
  referencePageId?: string;
}
