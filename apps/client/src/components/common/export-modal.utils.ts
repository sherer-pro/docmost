import { DatabaseExportFormat } from '@/features/database/types/database.types';
import { ExportFormat } from '@/features/page/types/page.types.ts';

export type ExportTargetType = 'space' | 'page' | 'database';

export function getExportFormatValues(type: ExportTargetType): string[] {
  if (type === 'database') {
    return [
      DatabaseExportFormat.Markdown,
      DatabaseExportFormat.HTML,
      DatabaseExportFormat.PDF,
    ];
  }

  if (type === 'page') {
    return [ExportFormat.Markdown, ExportFormat.HTML, ExportFormat.PDF];
  }

  return [ExportFormat.Markdown, ExportFormat.HTML];
}

export function shouldShowIncludeChildren(
  type: ExportTargetType,
  _format: string,
): boolean {
  return type === 'page' || type === 'database';
}

export function shouldShowAttachments(type: ExportTargetType): boolean {
  return type === 'page' || type === 'space' || type === 'database';
}

export function isSpaceExportFormat(
  format: string,
): format is ExportFormat.HTML | ExportFormat.Markdown {
  return format === ExportFormat.HTML || format === ExportFormat.Markdown;
}
