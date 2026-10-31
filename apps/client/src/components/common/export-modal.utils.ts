import { DatabaseExportFormat } from "@/features/database/types/database.types";
import { ExportFormat } from "@/features/page/types/page.types.ts";

export type ExportTargetType = "space" | "page" | "database";

export function getExportFormatValues(type: ExportTargetType): string[] {
  if (type === "database") {
    return [
      DatabaseExportFormat.Docmost,
      DatabaseExportFormat.Markdown,
      DatabaseExportFormat.HTML,
      DatabaseExportFormat.PDF,
      DatabaseExportFormat.CSV,
    ];
  }

  if (type === "page") {
    return [
      ExportFormat.Docmost,
      ExportFormat.Markdown,
      ExportFormat.HTML,
      ExportFormat.PDF,
      ExportFormat.DOCX,
    ];
  }

  return [ExportFormat.Docmost, ExportFormat.Markdown, ExportFormat.HTML];
}

export function shouldShowIncludeChildren(
  type: ExportTargetType,
  format: string,
): boolean {
  return (
    type === "page" ||
    (type === "database" &&
      ![ExportFormat.Docmost, DatabaseExportFormat.CSV].includes(format as any))
  );
}

export function shouldShowAttachments(
  type: ExportTargetType,
  format?: string,
): boolean {
  return (
    format !== ExportFormat.Docmost &&
    format !== DatabaseExportFormat.CSV &&
    (type === "page" || type === "space" || type === "database")
  );
}

export function isSpaceExportFormat(
  format: string,
): format is ExportFormat.Docmost | ExportFormat.HTML | ExportFormat.Markdown {
  return (
    format === ExportFormat.Docmost ||
    format === ExportFormat.HTML ||
    format === ExportFormat.Markdown
  );
}
