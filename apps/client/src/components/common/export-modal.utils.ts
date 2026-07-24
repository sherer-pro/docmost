import { DatabaseExportFormat } from '@/features/database/types/database.types';
import { ExportFormat } from '@/features/page/types/page.types.ts';

export type ExportTargetType = 'space' | 'page' | 'database';

export function getExportFormatValues(type: ExportTargetType): string[] {
  if (type === 'database') {
    return [
      DatabaseExportFormat.Docmost,
      DatabaseExportFormat.Markdown,
      DatabaseExportFormat.HTML,
      DatabaseExportFormat.PDF,
    ];
  }

  if (type === 'page') {
    return [
      ExportFormat.Docmost,
      ExportFormat.Markdown,
      ExportFormat.HTML,
      ExportFormat.PDF,
    ];
  }

  return [ExportFormat.Docmost, ExportFormat.Markdown, ExportFormat.HTML];
}

export function shouldShowIncludeChildren(
  type: ExportTargetType,
  format: string,
): boolean {
  return type === 'page' || (type === 'database' && format !== ExportFormat.Docmost);
}

export function shouldShowAttachments(
  type: ExportTargetType,
  format?: string,
): boolean {
  return (
    format !== ExportFormat.Docmost &&
    (type === 'page' || type === 'space' || type === 'database')
  );
}

export function isSpaceExportFormat(
  format: string,
): format is
  | ExportFormat.Docmost
  | ExportFormat.HTML
  | ExportFormat.Markdown {
  return (
    format === ExportFormat.Docmost ||
    format === ExportFormat.HTML ||
    format === ExportFormat.Markdown
  );
}
