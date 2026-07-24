import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export enum ExportFormat {
  Docmost = 'docmost',
  HTML = 'html',
  Markdown = 'markdown',
  PDF = 'pdf',
}

export class ExportPageDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsString()
  @IsIn(['docmost', 'html', 'markdown', 'pdf'])
  format: ExportFormat;

  @IsOptional()
  @IsBoolean()
  includeChildren?: boolean;

  @IsOptional()
  @IsBoolean()
  includeAttachments?: boolean;
}

export class CopyMarkdownWithCommentsDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class ExportSpaceDto {
  @IsString()
  @IsNotEmpty()
  spaceId: string;

  @IsString()
  @IsIn(['docmost', 'html', 'markdown'])
  format: ExportFormat;

  @IsOptional()
  @IsBoolean()
  includeAttachments?: boolean;
}
