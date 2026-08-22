import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkspaceDto } from './create-workspace.dto';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

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
  disablePublicSharing: boolean;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3650)
  pageHistoryRetentionDays?: number | null;
}
