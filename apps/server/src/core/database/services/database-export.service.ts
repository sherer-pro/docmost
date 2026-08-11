import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import type { User } from '@docmost/db/types/entity.types';
import type { DatabaseExportViewSnapshot } from '@docmost/api-contract';
import * as JSZip from 'jszip';
import { DatabaseExportFormat } from '../dto/database.dto';
import { ExportService } from '../../../integrations/export/export.service';
import { ExportFormat } from '../../../integrations/export/dto/export-dto';
import { ExportMetadata } from '../../../common/helpers/types/export-metadata.types';
import { replaceInternalLinks } from '../../../integrations/export/utils';
import { getProsemirrorContent } from '../../../common/helpers/prosemirror/utils';
import { streamToBuffer } from '../../../integrations/storage/storage.utils';
import { normalizeUserSettings } from '../../user/utils/user-preferences.util';
import type {
  DatabaseExportCellDisplay,
  DatabaseExportTableState,
} from './database-export.types';

export interface DatabaseExportRequest {
  databaseId: string;
  databasePageId: string;
  databaseName: string | null | undefined;
  format: DatabaseExportFormat;
  user: User;
  workspaceId: string;
  includeChildren: boolean;
  includeAttachments: boolean;
  currentView?: DatabaseExportViewSnapshot;
  tableState?: DatabaseExportTableState;
  cellDisplay: DatabaseExportCellDisplay;
}

@Injectable()
export class DatabaseExportService {
  constructor(
    private readonly exportService: ExportService,
    private readonly pageRepo: PageRepo,
  ) {}

  buildMarkdown(
    tableState: DatabaseExportTableState,
    cellDisplay: DatabaseExportCellDisplay,
  ): string {
    const title = tableState.database.name?.trim() || 'Database';
    return `# ${title}\n\n${this.buildRowsMarkdown(tableState, cellDisplay)}`;
  }

  async exportDatabase(request: DatabaseExportRequest) {
    if (request.format === DatabaseExportFormat.Docmost) {
      const archive = await this.exportService.exportDatabaseArchive(
        request.databaseId,
        request.user,
      );
      return {
        contentType: 'application/zip',
        fileName: archive.fileName,
        fileStream: archive.fileStream,
      };
    }

    if (!request.tableState) {
      throw new Error('Database export table state is required');
    }

    const safeName = (request.databaseName?.trim() || 'database')
      .replace(/\s+/g, '-')
      .toLowerCase();
    const allowedPageIds =
      request.currentView && request.includeChildren
        ? await this.buildCurrentViewAllowedPageIds(
            request.databasePageId,
            request.tableState.rows.map((row) => row.pageId).filter(Boolean),
            request.tableState.allRowPageIds,
          )
        : undefined;

    if (request.format === DatabaseExportFormat.PDF) {
      const pagesZipStream = await this.exportPagesForUser(
        request.databasePageId,
        ExportFormat.PDF,
        request.includeAttachments,
        request.includeChildren,
        request.user,
        allowedPageIds,
      );
      const pagesZipBuffer = await streamToBuffer(
        pagesZipStream as NodeJS.ReadableStream,
      );
      const zip = await JSZip.loadAsync(pagesZipBuffer);
      const rootPdfPath = await this.resolveRootExportPathFromMetadata(zip);
      const mergedRootPdfBody = await this.buildMergedRootPdfBodyHtml({
        databasePageId: request.databasePageId,
        user: request.user,
        workspaceId: request.workspaceId,
        locale: request.user.locale,
        rootMetadataPath: rootPdfPath.metadataPath,
        slugIdToExportPath: this.buildSlugIdToExportPathMap(
          rootPdfPath.metadata,
        ),
        tableState: request.tableState,
        cellDisplay: request.cellDisplay,
      });
      const mergedRootPdfBuffer =
        await this.exportService.renderPdfFromHtmlDocument({
          title: mergedRootPdfBody.title,
          bodyHtml: mergedRootPdfBody.bodyHtml,
          attachmentTokens: mergedRootPdfBody.attachmentTokens,
        });

      zip.file(rootPdfPath.zipPath, mergedRootPdfBuffer);
      return {
        contentType: 'application/zip',
        fileName: `${safeName}.zip`,
        fileStream: zip.generateNodeStream({
          type: 'nodebuffer',
          streamFiles: true,
          compression: 'DEFLATE',
        }),
      };
    }

    const pageExportFormat =
      request.format === DatabaseExportFormat.HTML
        ? ExportFormat.HTML
        : ExportFormat.Markdown;
    const zipFileStream = await this.exportPagesForUser(
      request.databasePageId,
      pageExportFormat,
      request.includeAttachments,
      request.includeChildren,
      request.user,
      allowedPageIds,
    );
    const zipBuffer = await streamToBuffer(
      zipFileStream as NodeJS.ReadableStream,
    );
    const zip = await JSZip.loadAsync(zipBuffer);
    await this.appendRowsToRootExport(
      zip,
      pageExportFormat,
      request.tableState,
      request.cellDisplay,
    );

    return {
      contentType: 'application/zip',
      fileName: `${safeName}.zip`,
      fileStream: zip.generateNodeStream({
        type: 'nodebuffer',
        streamFiles: true,
        compression: 'DEFLATE',
      }),
    };
  }

  private buildRowsMarkdown(
    tableState: DatabaseExportTableState,
    cellDisplay: DatabaseExportCellDisplay,
  ): string {
    const header = [
      'Title',
      ...tableState.properties.map((property) => property.name || 'Column'),
    ];
    const separator = header.map(() => '---');
    const rows = tableState.rows.map((row) => [
      this.escapeMarkdownCell(row.page?.title || row.pageTitle || ''),
      ...tableState.properties.map((property) =>
        this.escapeMarkdownCell(cellDisplay(row, property.id)),
      ),
    ]);

    return [header, separator, ...rows]
      .map((line) => `| ${line.join(' | ')} |`)
      .join('\n');
  }

  private buildRowsTableSectionHtml(
    tableState: DatabaseExportTableState,
    cellDisplay: DatabaseExportCellDisplay,
  ): string {
    const headers = [
      'Title',
      ...tableState.properties.map((property) => property.name || 'Column'),
    ];
    const rowsHtml = tableState.rows.length
      ? tableState.rows
          .map((row) => {
            const valueCells = tableState.properties
              .map(
                (property) =>
                  `<td>${this.escapeHtml(cellDisplay(row, property.id))}</td>`,
              )
              .join('');
            return `<tr><td>${this.escapeHtml(
              row.page?.title || row.pageTitle || '',
            )}</td>${valueCells}</tr>`;
          })
          .join('')
      : `<tr><td colspan="${headers.length}">No rows</td></tr>`;
    const headerHtml = headers
      .map((header) => `<th>${this.escapeHtml(header)}</th>`)
      .join('');

    return `<section class="docmost-database-summary">
      <h2>Rows</h2>
      <table>
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </section>`;
  }

  private async appendRowsToRootExport(
    zip: JSZip,
    format: ExportFormat.Markdown | ExportFormat.HTML,
    tableState: DatabaseExportTableState,
    cellDisplay: DatabaseExportCellDisplay,
  ): Promise<void> {
    const rootPath = await this.resolveRootExportPathFromMetadata(zip);
    const rootEntry = zip.file(rootPath.zipPath);
    if (!rootEntry)
      throw new NotFoundException('Root file is missing in export archive');

    const rootContent = await rootEntry.async('text');
    if (format === ExportFormat.Markdown) {
      zip.file(
        rootPath.zipPath,
        `${rootContent.trimEnd()}\n\n## Rows\n\n${this.buildRowsMarkdown(
          tableState,
          cellDisplay,
        )}\n`,
      );
      return;
    }

    const tableHtml = this.buildRowsTableSectionHtml(tableState, cellDisplay);
    zip.file(
      rootPath.zipPath,
      /<\/body>/i.test(rootContent)
        ? rootContent.replace(/<\/body>/i, `${tableHtml}</body>`)
        : `${rootContent}${tableHtml}`,
    );
  }

  private async buildMergedRootPdfBodyHtml(params: {
    databasePageId: string;
    user: User;
    workspaceId: string;
    locale?: string;
    rootMetadataPath: string;
    slugIdToExportPath: Record<string, string>;
    tableState: DatabaseExportTableState;
    cellDisplay: DatabaseExportCellDisplay;
  }) {
    const rootPage = await this.pageRepo.findById(params.databasePageId, {
      includeContent: true,
    });
    if (
      !rootPage ||
      rootPage.deletedAt ||
      rootPage.workspaceId !== params.workspaceId
    ) {
      throw new NotFoundException('Database root page not found');
    }

    const content = await this.exportService.prepareProsemirrorForExport(
      getProsemirrorContent(rootPage.content),
      rootPage.workspaceId,
      params.user,
      params.locale,
    );
    const pageBody = await this.exportService.buildPagePdfBody({
      page: {
        ...rootPage,
        content: replaceInternalLinks(
          content,
          params.slugIdToExportPath,
          params.rootMetadataPath,
        ),
      },
      locale: params.locale,
      authorizedUser: params.user,
    });

    return {
      title: pageBody.title,
      bodyHtml: `${pageBody.bodyHtml}${this.buildRowsTableSectionHtml(
        params.tableState,
        params.cellDisplay,
      )}`,
      attachmentTokens: pageBody.attachmentTokens,
    };
  }

  private async buildCurrentViewAllowedPageIds(
    databasePageId: string,
    rowPageIds: string[],
    allRowPageIds: Set<string>,
  ): Promise<Set<string>> {
    const pages =
      (await this.pageRepo.getPageAndDescendants(databasePageId, {
        includeContent: false,
      })) ?? [];
    const pagesById = new Map(pages.map((page) => [page.id, page]));
    const childrenByParentId = new Map<string, string[]>();
    for (const page of pages) {
      if (!page.parentPageId) continue;
      const children = childrenByParentId.get(page.parentPageId) ?? [];
      children.push(page.id);
      childrenByParentId.set(page.parentPageId, children);
    }

    const allowedPageIds = new Set<string>([databasePageId]);
    const selectedRowPageIds = new Set(rowPageIds);
    const queue = rowPageIds.filter((pageId) => pagesById.has(pageId));
    while (queue.length) {
      const pageId = queue.shift();
      if (!pageId || allowedPageIds.has(pageId)) continue;
      allowedPageIds.add(pageId);
      queue.push(
        ...(childrenByParentId.get(pageId) ?? []).filter(
          (childId) =>
            !allRowPageIds.has(childId) || selectedRowPageIds.has(childId),
        ),
      );
    }
    return allowedPageIds;
  }

  private exportPagesForUser(
    pageId: string,
    format: ExportFormat,
    includeAttachments: boolean,
    includeChildren: boolean,
    user: User,
    allowedPageIds?: Set<string>,
  ) {
    const perPage = normalizeUserSettings(user.settings).preferences
      .headingNumberingByPageId;
    const headingNumbering = Object.keys(perPage).length ? perPage : undefined;
    if (allowedPageIds) {
      return this.exportService.exportPages(
        pageId,
        format,
        includeAttachments,
        includeChildren,
        user.locale,
        headingNumbering,
        user,
        allowedPageIds,
      );
    }

    return this.exportService.exportPages(
      pageId,
      format,
      includeAttachments,
      includeChildren,
      user.locale,
      headingNumbering,
      user,
    );
  }

  private async resolveExportMetadata(zip: JSZip): Promise<ExportMetadata> {
    const entry = zip.file('docmost-metadata.json');
    if (!entry) throw new NotFoundException('Export metadata is missing');
    try {
      const metadata: unknown = JSON.parse(await entry.async('text'));
      if (!metadata || typeof metadata !== 'object') {
        throw new Error('Export metadata must be an object');
      }
      return metadata as ExportMetadata;
    } catch (error) {
      throw new BadRequestException(
        `Export metadata is invalid: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async resolveRootExportPathFromMetadata(zip: JSZip) {
    const metadata = await this.resolveExportMetadata(zip);
    const root = Object.entries(metadata.pages || {}).find(
      ([, page]) => page?.parentPath === null,
    );
    if (!root) throw new NotFoundException('Root page metadata is missing');
    const [metadataPath] = root;
    const decodedPath = metadataPath
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join('/');
    for (const zipPath of [...new Set([metadataPath, decodedPath])]) {
      if (zip.file(zipPath)) return { metadata, metadataPath, zipPath };
    }
    throw new NotFoundException('Root file is missing in export archive');
  }

  private buildSlugIdToExportPathMap(
    metadata: ExportMetadata,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [path, page] of Object.entries(metadata.pages || {})) {
      if (page?.slugId) result[page.slugId] = path;
    }
    return result;
  }

  private escapeMarkdownCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
