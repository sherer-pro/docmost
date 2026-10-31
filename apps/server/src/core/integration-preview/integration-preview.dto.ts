import {
  IsBoolean,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResolveIntegrationPreviewDto {
  @IsUUID() pageId: string;
  @IsString() @MaxLength(2048) url: string;
}

export class SaveIntegrationPreviewConnectionDto {
  @IsString() @MinLength(1) @MaxLength(4096) credential: string;
}

export class UpdateIntegrationPreviewSettingsDto {
  @IsBoolean() enabled: boolean;
}
