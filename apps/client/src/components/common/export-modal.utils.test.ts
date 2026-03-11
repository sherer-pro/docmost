import { describe, expect, it } from 'vitest';
import { DatabaseExportFormat } from '@/features/database/types/database.types';
import { ExportFormat } from '@/features/page/types/page.types.ts';
import {
  getExportFormatValues,
  isSpaceExportFormat,
  shouldShowAttachments,
  shouldShowIncludeChildren,
} from './export-modal.utils';

describe('export modal utils', () => {
  it('includes PDF in page export format values', () => {
    const formatValues = getExportFormatValues('page');

    expect(formatValues).toEqual([
      ExportFormat.Markdown,
      ExportFormat.HTML,
      ExportFormat.PDF,
    ]);
  });

  it('includes HTML and PDF in database export format values', () => {
    const formatValues = getExportFormatValues('database');

    expect(formatValues).toEqual([
      DatabaseExportFormat.Markdown,
      DatabaseExportFormat.HTML,
      DatabaseExportFormat.PDF,
    ]);
  });

  it('shows include subpages for database in all formats', () => {
    expect(shouldShowIncludeChildren('database', DatabaseExportFormat.Markdown)).toBe(
      true,
    );
    expect(shouldShowIncludeChildren('database', DatabaseExportFormat.PDF)).toBe(
      true,
    );
  });

  it('marks attachments visibility for page/space/database', () => {
    expect(shouldShowAttachments('page')).toBe(true);
    expect(shouldShowAttachments('space')).toBe(true);
    expect(shouldShowAttachments('database')).toBe(true);
  });

  it('accepts only HTML and Markdown for space export', () => {
    expect(isSpaceExportFormat(ExportFormat.HTML)).toBe(true);
    expect(isSpaceExportFormat(ExportFormat.Markdown)).toBe(true);
    expect(isSpaceExportFormat(ExportFormat.PDF)).toBe(false);
  });
});
