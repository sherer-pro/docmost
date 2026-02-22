import { PartialType } from '@nestjs/mapped-types';
import { CreateSpaceDto } from './create-space.dto';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSpaceDocumentFieldsDto {
  @IsBoolean()
  status: boolean;

  @IsBoolean()
  assignee: boolean;

  @IsBoolean()
  stakeholders: boolean;
}

export class UpdateSpaceDto extends PartialType(CreateSpaceDto) {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsBoolean()
  disablePublicSharing: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSpaceDocumentFieldsDto)
  documentFields?: UpdateSpaceDocumentFieldsDto;
}
