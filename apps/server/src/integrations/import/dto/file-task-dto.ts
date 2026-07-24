import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class FileTaskIdDto {
  @IsNotEmpty()
  @IsUUID()
  fileTaskId: string;
}

export class ConfirmDocmostImportDto extends FileTaskIdDto {
  @IsBoolean()
  applyDocumentFields: boolean;

  @IsBoolean()
  applyDictionary: boolean;

  @IsBoolean()
  applyHeadingNumbering: boolean;

  @IsOptional()
  @IsBoolean()
  cleanupLegacyHeadingNumbers?: boolean;
}

export class RecentDocmostImportReportsDto {
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export type ImportPageNode = {
  id: string;
  slugId: string;
  name: string;
  content: string;
  position?: string | null;
  parentPageId: string | null;
  fileExtension: string;
  filePath: string;
  icon?: string | null;
};
