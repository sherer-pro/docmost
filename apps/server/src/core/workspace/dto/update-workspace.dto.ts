import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkspaceDto } from './create-workspace.dto';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { builtInTagValues } from '@docmost/editor-ext';

export class WorkspaceTagSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(builtInTagValues, { each: true })
  disabled?: string[];
}

export class UpdateWorkspaceDto extends PartialType(CreateWorkspaceDto) {
  @IsOptional()
  @IsString()
  logo: string;

  @IsOptional()
  @IsArray()
  emailDomains: string[];

  @IsOptional()
  @IsBoolean()
  enforceSso: boolean;

  @IsOptional()
  @IsBoolean()
  enforceMfa: boolean;

  @IsOptional()
  @IsBoolean()
  restrictApiToAdmins: boolean;

  @IsOptional()
  @IsBoolean()
  aiSearch: boolean;

  @IsOptional()
  @IsBoolean()
  generativeAi: boolean;

  @IsOptional()
  @IsBoolean()
  disablePublicSharing: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkspaceTagSettingsDto)
  tagSettings?: WorkspaceTagSettingsDto;
}
