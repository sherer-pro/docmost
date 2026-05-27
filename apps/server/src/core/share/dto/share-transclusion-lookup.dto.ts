import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ShareTransclusionReferenceDto {
  @IsUUID()
  sourcePageId!: string;

  @IsString()
  @MaxLength(36)
  transclusionId!: string;
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
}
