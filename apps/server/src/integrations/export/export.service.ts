import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { jsonToHtml, jsonToNode } from '../../collaboration/collaboration.util';
import { ExportFormat } from './dto/export-dto';
import { Page } from '@docmost/db/types/entity.types';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import * as JSZip from 'jszip';
import { StorageService } from '../storage/storage.service';
import {
  buildTree,
  computeLocalPath,
  getExportExtension,
  getPageTitle,
  PageExportTree,
  replaceInternalLinks,
  updateAttachmentUrlsToLocalPaths,
} from './utils';
import {
  ExportMetadata,
  ExportPageMetadata,
} from '../../common/helpers/types/export-metadata.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Node } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import slugify = require('@sindresorhus/slugify');
import { EnvironmentService } from '../environment/environment.service';
import {
  getAttachmentIds,
  getProsemirrorContent,
} from '../../common/helpers/prosemirror/utils';
import { htmlToMarkdown } from '@docmost/editor-ext';
import { getAppVersion } from '../../common/helpers/get-app-version';
import {
  getPageAssigneeId,
  getPageStakeholderIds,
  normalizePageSettings,
} from '../../core/page/utils/page-settings.utils';
import { HtmlPdfRendererService } from './html-pdf-renderer.service';
import * as cheerio from 'cheerio';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveClientDistPath } from '../../common/utils/client-dist-path';

const PAGE_STATUS_LABELS: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
};

const PAGE_CUSTOM_FIELD_LABEL_KEYS = ['Status', 'Assignee', 'Stakeholders'] as const;
type PageCustomFieldLabelKey = (typeof PAGE_CUSTOM_FIELD_LABEL_KEYS)[number];
type PageCustomFieldLabels = Record<PageCustomFieldLabelKey, string>;

const DEFAULT_PAGE_CUSTOM_FIELD_LABELS: PageCustomFieldLabels = {
  Status: 'Status',
  Assignee: 'Assignee',
  Stakeholders: 'Stakeholders',
};

const DEFAULT_EXPORT_LOCALE = 'en-US';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private readonly appVersion = getAppVersion();
  private readonly clientLocaleRoots = this.resolveClientLocaleRoots();
  private readonly localeTranslationsCache = new Map<
    string,
    Record<string, unknown> | null
  >();
  private readonly pageCustomFieldLabelsCache = new Map<
    string,
    PageCustomFieldLabels
  >();
  private availableClientLocalesCache: string[] | null = null;

  constructor(
    private readonly pageRepo: PageRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
    private readonly environmentService: EnvironmentService,
    private readonly htmlPdfRendererService: HtmlPdfRendererService,
  ) {}

  async exportPage(
    format: string,
    page: Page,
    singlePage?: boolean,
    locale?: string,
  ) {
    const { title: pageTitle, pageHtml } = await this.buildPageExportHtml(
      page,
      singlePage,
    );

    if (format === ExportFormat.HTML) {
      return `<!DOCTYPE html>
      <html>
        <head>
         <title>${pageTitle}</title>
        </head>
        <body>${pageHtml}</body>
      </html>`;
    }

    if (format === ExportFormat.Markdown) {
      return htmlToMarkdown(pageHtml);
    }

    if (format === ExportFormat.PDF) {
      const pagePdfBody = await this.buildPagePdfBody({
        page,
        locale,
        singlePage,
        pageHtml,
      });

      return this.renderPdfFromHtmlDocument({
        title: pagePdfBody.title,
        bodyHtml: pagePdfBody.bodyHtml,
      });
    }

    return;
  }

  async buildPagePdfBody(params: {
    page: Page;
    locale?: string;
    singlePage?: boolean;
    pageHtml?: string;
  }): Promise<{ title: string; bodyHtml: string }> {
    const pageTitle = getPageTitle(params.page.title);
    let pageHtml = params.pageHtml;

    if (!pageHtml) {
      const pageHtmlResult = await this.buildPageExportHtml(
        params.page,
        params.singlePage,
      );
      pageHtml = pageHtmlResult.pageHtml;
    }

    const metadataRows = await this.resolvePageMetadataRows(
      params.page,
      params.locale,
    );
    const bodyHtml = this.buildPagePdfBodyHtml(pageHtml, metadataRows);

    return {
      title: pageTitle,
      bodyHtml,
    };
  }

  private async buildPageExportHtml(
    page: Page,
    singlePage?: boolean,
  ): Promise<{ title: string; pageHtml: string }> {
    const titleNode = {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: getPageTitle(page.title) }],
    };

    let prosemirrorJson: any;

    if (singlePage) {
      prosemirrorJson = await this.turnPageMentionsToLinks(
        getProsemirrorContent(page.content),
        page.workspaceId,
      );
    } else {
      // mentions is already turned to links during the zip process
      prosemirrorJson = getProsemirrorContent(page.content);
    }

    if (page.title) {
      prosemirrorJson.content.unshift(titleNode);
    }

    const pageHtml = this.removeColgroupTags(jsonToHtml(prosemirrorJson));

    return {
      title: getPageTitle(page.title),
      pageHtml,
    };
  }

  async renderPdfFromHtmlDocument(params: {
    title: string;
    bodyHtml: string;
  }): Promise<Buffer> {
    const htmlDocument = this.buildPdfHtmlDocument(params.title, params.bodyHtml);
    return this.htmlPdfRendererService.render(htmlDocument);
  }

  private removeColgroupTags(html: string): string {
    return html.replace(/<colgroup[^>]*>[\s\S]*?<\/colgroup>/gim, '');
  }

  private buildPdfHtmlDocument(title: string, bodyHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${this.escapeHtml(title)}</title>
    <style>
      @page {
        size: A4;
        margin: 16mm 12mm;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 0;
        color: #111827;
        background: #ffffff;
        font-family: "Noto Sans", "DejaVu Sans", "Segoe UI", "Arial Unicode MS", Arial, sans-serif;
        font-size: 12px;
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
      }
      .docmost-export-root {
        width: 100%;
      }
      h1,
      h2,
      h3,
      h4 {
        margin: 1.1em 0 0.45em;
        line-height: 1.25;
      }
      h1 {
        font-size: 2em;
      }
      h2 {
        font-size: 1.5em;
      }
      h3 {
        font-size: 1.25em;
      }
      p,
      ul,
      ol,
      pre,
      blockquote,
      table {
        margin: 0.75em 0;
      }
      a {
        color: #0f766e;
        text-decoration: underline;
      }
      img,
      video {
        display: block;
        max-width: 100%;
        height: auto;
      }
      pre {
        background: #f3f4f6;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        padding: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      code {
        font-family: "Fira Code", "JetBrains Mono", "DejaVu Sans Mono", "Consolas", monospace;
      }
      blockquote {
        border-left: 3px solid #d1d5db;
        margin-left: 0;
        padding-left: 12px;
        color: #4b5563;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        border: 1px solid #d1d5db;
        table-layout: fixed;
      }
      th,
      td {
        border: 1px solid #d1d5db;
        padding: 8px;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
      }
      th {
        background: #f9fafb;
        font-weight: 600;
      }
      .docmost-page-metadata {
        margin-bottom: 16px;
        padding: 12px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #f8fafc;
      }
      .docmost-page-metadata h2 {
        margin: 0 0 8px;
        font-size: 14px;
      }
      .docmost-page-metadata dl {
        margin: 0;
        display: grid;
        gap: 6px;
      }
      .docmost-page-meta-item {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 8px;
      }
      .docmost-page-meta-item dt {
        margin: 0;
        color: #4b5563;
      }
      .docmost-page-meta-item dd {
        margin: 0;
        font-weight: 500;
      }
      .docmost-link-preview-block,
      .docmost-embed-card,
      .docmost-diagram-fallback,
      .docmost-subpages-fallback {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 10px;
        margin: 0.75em 0;
        background: #ffffff;
      }
      .docmost-link-preview-image {
        border-radius: 8px;
        margin-bottom: 8px;
      }
      .docmost-link-preview-site {
        margin: 0 0 4px;
        color: #6b7280;
        font-size: 11px;
      }
      .docmost-link-preview-title,
      .docmost-fallback-title {
        margin: 0 0 4px;
        font-size: 13px;
        font-weight: 600;
      }
      .docmost-link-preview-description {
        margin: 0 0 6px;
        color: #4b5563;
      }
      .docmost-link-preview-url,
      .docmost-fallback-link {
        margin: 0;
        display: inline-block;
      }
      .docmost-fallback-description {
        margin: 0 0 6px;
        color: #4b5563;
      }
    </style>
  </head>
  <body>
    <main class="docmost-export-root">${bodyHtml}</main>
  </body>
</html>`;
  }

  private buildPagePdfBodyHtml(
    pageHtml: string,
    metadataRows: Array<{ label: string; value: string }>,
  ): string {
    const metadataBlock =
      metadataRows.length > 0
        ? `<section class="docmost-page-metadata">
             <dl>
               ${metadataRows
                 .map(
                   (item) =>
                     `<div class="docmost-page-meta-item"><dt>${this.escapeHtml(item.label)}</dt><dd>${this.escapeHtml(item.value)}</dd></div>`,
                 )
                 .join('')}
             </dl>
           </section>`
        : '';

    const pageContentHtml = this.applyPdfCustomBlockFallbacks(pageHtml);

    return `${metadataBlock}<article class="docmost-page-content">${pageContentHtml}</article>`;
  }

  private async resolvePageMetadataRows(
    page: Page,
    locale?: string,
  ): Promise<Array<{ label: string; value: string }>> {
    const settings = normalizePageSettings(page.settings);
    const statusLabel = this.resolvePageStatusLabel(settings.status);
    const assigneeId = getPageAssigneeId(settings);
    const stakeholderIds = getPageStakeholderIds(settings);
    const userIds = [...new Set([...(assigneeId ? [assigneeId] : []), ...stakeholderIds])];
    const userNameById = await this.resolveUserNameMap(userIds, page.workspaceId);
    const metadataLabels = this.resolvePageCustomFieldLabels(locale);
    const rows: Array<{ label: string; value: string }> = [];

    if (statusLabel) {
      rows.push({ label: metadataLabels.Status, value: statusLabel });
    }

    if (assigneeId) {
      rows.push({
        label: metadataLabels.Assignee,
        value: userNameById.get(assigneeId) || assigneeId,
      });
    }

    if (stakeholderIds.length > 0) {
      const stakeholderNames = stakeholderIds.map(
        (stakeholderId) => userNameById.get(stakeholderId) || stakeholderId,
      );
      rows.push({
        label: metadataLabels.Stakeholders,
        value: stakeholderNames.join(', '),
      });
    }

    return rows;
  }

  private resolvePageCustomFieldLabels(locale?: string): PageCustomFieldLabels {
    const normalizedLocale = this.normalizeLocale(locale);
    const cacheKey = normalizedLocale || DEFAULT_EXPORT_LOCALE;
    const cachedLabels = this.pageCustomFieldLabelsCache.get(cacheKey);

    if (cachedLabels) {
      return cachedLabels;
    }

    const resolvedLabels: PageCustomFieldLabels = {
      ...DEFAULT_PAGE_CUSTOM_FIELD_LABELS,
    };

    const unresolvedLabels = new Set<PageCustomFieldLabelKey>(
      PAGE_CUSTOM_FIELD_LABEL_KEYS,
    );

    for (const localeCandidate of this.buildLocaleFallbackChain(normalizedLocale)) {
      const translations = this.readLocaleTranslations(localeCandidate);
      if (!translations) {
        continue;
      }

      for (const labelKey of PAGE_CUSTOM_FIELD_LABEL_KEYS) {
        if (!unresolvedLabels.has(labelKey)) {
          continue;
        }

        const translatedLabel = this.readTranslationString(translations, labelKey);
        if (!translatedLabel) {
          continue;
        }

        resolvedLabels[labelKey] = translatedLabel;
        unresolvedLabels.delete(labelKey);
      }

      if (unresolvedLabels.size === 0) {
        break;
      }
    }

    this.pageCustomFieldLabelsCache.set(cacheKey, resolvedLabels);
    return resolvedLabels;
  }

  private buildLocaleFallbackChain(locale?: string): string[] {
    const normalizedLocale = this.normalizeLocale(locale);
    const fallbackChain: string[] = [];

    if (normalizedLocale) {
      fallbackChain.push(normalizedLocale);
    }

    const languageCode = normalizedLocale.split(/[-_]/)[0]?.toLowerCase();
    if (languageCode) {
      const languageFallbackLocales = this.getAvailableClientLocales().filter(
        (availableLocale) => {
          const normalizedAvailableLocale = availableLocale.toLowerCase();

          return (
            normalizedAvailableLocale === languageCode ||
            normalizedAvailableLocale.startsWith(`${languageCode}-`)
          );
        },
      );

      languageFallbackLocales.sort((left, right) =>
        left.localeCompare(right, 'en'),
      );

      for (const languageLocale of languageFallbackLocales) {
        if (!fallbackChain.includes(languageLocale)) {
          fallbackChain.push(languageLocale);
        }
      }
    }

    if (!fallbackChain.includes(DEFAULT_EXPORT_LOCALE)) {
      fallbackChain.push(DEFAULT_EXPORT_LOCALE);
    }

    return fallbackChain;
  }

  private getAvailableClientLocales(): string[] {
    if (this.availableClientLocalesCache) {
      return this.availableClientLocalesCache;
    }

    const discoveredLocales = new Set<string>();

    for (const localeRoot of this.clientLocaleRoots) {
      if (!existsSync(localeRoot)) {
        continue;
      }

      const localeFolders = readdirSync(localeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      for (const localeFolder of localeFolders) {
        discoveredLocales.add(localeFolder);
      }
    }

    this.availableClientLocalesCache = [...discoveredLocales].sort((left, right) =>
      left.localeCompare(right, 'en'),
    );

    return this.availableClientLocalesCache;
  }

  private resolveClientLocaleRoots(): string[] {
    const localeRoots = new Set<string>();
    const clientDistPath = resolveClientDistPath(__dirname);

    if (clientDistPath) {
      localeRoots.add(join(clientDistPath, 'locales'));
      localeRoots.add(join(clientDistPath, '..', 'public', 'locales'));
    }

    localeRoots.add(
      join(__dirname, '..', '..', '..', '..', 'client', 'public', 'locales'),
    );
    localeRoots.add(join(process.cwd(), 'apps', 'client', 'public', 'locales'));
    localeRoots.add(join(process.cwd(), '..', 'client', 'public', 'locales'));

    return [...localeRoots].filter((localeRoot) => existsSync(localeRoot));
  }

  private readLocaleTranslations(locale: string): Record<string, unknown> | null {
    if (this.localeTranslationsCache.has(locale)) {
      return this.localeTranslationsCache.get(locale) ?? null;
    }

    for (const localeRoot of this.clientLocaleRoots) {
      const translationFilePath = join(localeRoot, locale, 'translation.json');
      if (!existsSync(translationFilePath)) {
        continue;
      }

      try {
        const content = readFileSync(translationFilePath, 'utf8');
        const parsedContent: unknown = JSON.parse(content);

        if (!parsedContent || typeof parsedContent !== 'object') {
          continue;
        }

        const translations = parsedContent as Record<string, unknown>;
        this.localeTranslationsCache.set(locale, translations);

        return translations;
      } catch (err) {
        this.logger.warn(
          `Failed to parse locale translations for ${locale} at ${translationFilePath}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    this.localeTranslationsCache.set(locale, null);
    return null;
  }

  private readTranslationString(
    translations: Record<string, unknown>,
    key: string,
  ): string | null {
    const directTranslation = translations[key];
    if (typeof directTranslation === 'string' && directTranslation.trim()) {
      return directTranslation.trim();
    }

    if (!key.includes('.')) {
      return null;
    }

    const nestedTranslation = key
      .split('.')
      .reduce<unknown>((cursor, pathChunk) => {
        if (!cursor || typeof cursor !== 'object') {
          return null;
        }

        const chunkValue = (cursor as Record<string, unknown>)[pathChunk];
        return typeof chunkValue === 'undefined' ? null : chunkValue;
      }, translations);

    if (typeof nestedTranslation !== 'string' || !nestedTranslation.trim()) {
      return null;
    }

    return nestedTranslation.trim();
  }

  private normalizeLocale(locale?: string): string {
    if (!locale) {
      return '';
    }

    return locale.trim();
  }

  private resolvePageStatusLabel(status: unknown): string | null {
    if (typeof status !== 'string') {
      return null;
    }

    const normalizedStatus = status.trim();
    if (!normalizedStatus) {
      return null;
    }

    if (PAGE_STATUS_LABELS[normalizedStatus]) {
      return PAGE_STATUS_LABELS[normalizedStatus];
    }

    return normalizedStatus
      .split(/[_-]+/)
      .filter(Boolean)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
      .join(' ');
  }

  private async resolveUserNameMap(
    userIds: string[],
    workspaceId: string,
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const users = await this.db
      .selectFrom('users')
      .select(['id', 'name'])
      .where('workspaceId', '=', workspaceId)
      .where('id', 'in', userIds)
      .execute();

    const userNameById = new Map<string, string>();

    for (const userId of userIds) {
      userNameById.set(userId, userId);
    }

    for (const user of users) {
      userNameById.set(user.id, user.name?.trim() || user.id);
    }

    return userNameById;
  }

  private applyPdfCustomBlockFallbacks(pageHtml: string): string {
    const $ = cheerio.load(`<div class="docmost-page-content-root">${pageHtml}</div>`);
    const root = $('.docmost-page-content-root');

    root.find('div[data-type="linkPreview"]').each((_, node) => {
      const previewNode = $(node);
      const url = this.readHtmlAttribute(previewNode, ['url', 'data-url']);
      const title = this.readHtmlAttribute(previewNode, ['title', 'data-title']);
      const description = this.readHtmlAttribute(previewNode, [
        'description',
        'data-description',
      ]);
      const image = this.readHtmlAttribute(previewNode, ['image', 'data-image']);
      const siteName = this.readHtmlAttribute(previewNode, ['siteName', 'data-site-name']);

      const previewCard = $('<section></section>').addClass('docmost-link-preview-block');

      if (image) {
        previewCard.append(
          $('<img />')
            .addClass('docmost-link-preview-image')
            .attr('src', image)
            .attr('alt', title || siteName || 'Link preview image'),
        );
      }

      const content = $('<div></div>').addClass('docmost-link-preview-content');
      if (siteName) {
        content.append(
          $('<p></p>').addClass('docmost-link-preview-site').text(siteName),
        );
      }
      if (title) {
        content.append(
          $('<p></p>').addClass('docmost-link-preview-title').text(title),
        );
      }
      if (description) {
        content.append(
          $('<p></p>')
            .addClass('docmost-link-preview-description')
            .text(description),
        );
      }
      if (url) {
        content.append(
          $('<a></a>')
            .addClass('docmost-link-preview-url')
            .attr('href', url)
            .attr('target', '_blank')
            .attr('rel', 'noopener noreferrer')
            .text(url),
        );
      }

      if (content.children().length > 0) {
        previewCard.append(content);
      }

      previewNode.replaceWith(previewCard);
    });

    root.find('div[data-type="embed"]').each((_, node) => {
      const embedNode = $(node);
      const provider = this.readHtmlAttribute(embedNode, [
        'data-provider',
        'provider',
      ]);
      const src = this.readHtmlAttribute(embedNode, ['data-src', 'src']);

      if (!src) {
        return;
      }

      const embedCard = $('<section></section>').addClass('docmost-embed-card');
      embedCard.append(
        $('<p></p>')
          .addClass('docmost-fallback-title')
          .text(provider ? `Embed (${provider})` : 'Embed'),
      );
      embedCard.append(
        $('<a></a>')
          .addClass('docmost-fallback-link')
          .attr('href', src)
          .attr('target', '_blank')
          .attr('rel', 'noopener noreferrer')
          .text(src),
      );

      embedNode.replaceWith(embedCard);
    });

    root.find('div[data-type="drawio"], div[data-type="excalidraw"]').each((_, node) => {
      const diagramNode = $(node);
      const src = this.readHtmlAttribute(diagramNode, ['data-src', 'src']);
      const title = this.readHtmlAttribute(diagramNode, ['data-title', 'title']);
      const typeName = this.readHtmlAttribute(diagramNode, ['data-type']);
      const normalizedTypeName =
        typeName === 'drawio' ? 'Draw.io diagram' : 'Excalidraw diagram';

      if (diagramNode.find('img').length > 0 || !src) {
        return;
      }

      const fallback = $('<section></section>').addClass('docmost-diagram-fallback');
      fallback.append(
        $('<p></p>')
          .addClass('docmost-fallback-title')
          .text(title || normalizedTypeName),
      );
      fallback.append(
        $('<a></a>')
          .addClass('docmost-fallback-link')
          .attr('href', src)
          .attr('target', '_blank')
          .attr('rel', 'noopener noreferrer')
          .text(src),
      );

      diagramNode.replaceWith(fallback);
    });

    root.find('div[data-type="subpages"]').each((_, node) => {
      const subpagesNode = $(node);
      const fallback = $('<section></section>').addClass('docmost-subpages-fallback');

      fallback.append(
        $('<p></p>')
          .addClass('docmost-fallback-title')
          .text('Subpages block'),
      );
      fallback.append(
        $('<p></p>')
          .addClass('docmost-fallback-description')
          .text('This block lists nested pages in the web view.'),
      );

      subpagesNode.replaceWith(fallback);
    });

    return root.html() || '';
  }

  private readHtmlAttribute(
    node: cheerio.Cheerio<any>,
    attributeNames: string[],
  ): string {
    for (const attributeName of attributeNames) {
      const candidate = node.attr(attributeName)?.trim();
      if (candidate) {
        return candidate;
      }
    }

    return '';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async exportPages(
    pageId: string,
    format: string,
    includeAttachments: boolean,
    includeChildren: boolean,
    locale?: string,
  ) {
    let pages: Page[];

    if (includeChildren) {
      //@ts-ignore
      pages = await this.pageRepo.getPageAndDescendants(pageId, {
        includeContent: true,
      });
    } else {
      // Only fetch the single page when includeChildren is false
      const page = await this.pageRepo.findById(pageId, {
        includeContent: true,
      });
      if (page){
        pages = [page];
      }
    }

    if (!pages || pages.length === 0) {
      throw new BadRequestException('No pages to export');
    }

    const parentPageIndex = pages.findIndex((obj) => obj.id === pageId);
    // set to null to make export of pages with parentId work
    pages[parentPageIndex].parentPageId = null;

    const tree = buildTree(pages as Page[]);

    const zip = new JSZip();
    await this.zipPages(tree, format, zip, includeAttachments, locale);

    const zipFile = zip.generateNodeStream({
      type: 'nodebuffer',
      streamFiles: true,
      compression: 'DEFLATE',
    });

    return zipFile;
  }

  async exportSpace(
    spaceId: string,
    format: string,
    includeAttachments: boolean,
    locale?: string,
  ) {
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', spaceId)
      .executeTakeFirst();

    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const pages = await this.db
      .selectFrom('pages')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.icon',
        'pages.position',
        'pages.content',
        'pages.parentPageId',
        'pages.spaceId',
        'pages.workspaceId',
        'pages.createdAt',
        'pages.updatedAt',
      ])
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .execute();

    const tree = buildTree(pages as Page[]);

    const zip = new JSZip();

    await this.zipPages(tree, format, zip, includeAttachments, locale);

    const zipFile = zip.generateNodeStream({
      type: 'nodebuffer',
      streamFiles: true,
      compression: 'DEFLATE',
    });

    const fileName = `${space.name}-space-export.zip`;
    return {
      fileStream: zipFile,
      fileName,
    };
  }

  async zipPages(
    tree: PageExportTree,
    format: string,
    zip: JSZip,
    includeAttachments: boolean,
    locale?: string,
  ): Promise<void> {
    const slugIdToPath: Record<string, string> = {};
    const pageIdToFilePath: Record<string, string> = {};
    const pagesMetadata: Record<string, ExportPageMetadata> = {};

    computeLocalPath(tree, format, null, '', slugIdToPath);

    const stack: { folder: JSZip; parentPageId: string | null }[] = [
      { folder: zip, parentPageId: null },
    ];

    while (stack.length > 0) {
      const { folder, parentPageId } = stack.pop();
      const children = tree[parentPageId] || [];

      for (const page of children) {
        const childPages = tree[page.id] || [];

        const prosemirrorJson = await this.turnPageMentionsToLinks(
          getProsemirrorContent(page.content),
          page.workspaceId,
        );

        const currentPagePath = slugIdToPath[page.slugId];

        let updatedJsonContent = replaceInternalLinks(
          prosemirrorJson,
          slugIdToPath,
          currentPagePath,
        );

        if (includeAttachments) {
          await this.zipAttachments(updatedJsonContent, page.spaceId, folder);
          updatedJsonContent =
            updateAttachmentUrlsToLocalPaths(updatedJsonContent);
        }

        const pageTitle = getPageTitle(page.title);
        const pageExportContent = await this.exportPage(format, {
          ...page,
          content: updatedJsonContent,
        }, false, locale);

        folder.file(
          `${pageTitle}${getExportExtension(format)}`,
          pageExportContent,
        );

        pageIdToFilePath[page.id] = currentPagePath;

        const parentPath = parentPageId ? pageIdToFilePath[parentPageId] : null;
        pagesMetadata[currentPagePath] = {
          pageId: page.id,
          slugId: page.slugId,
          icon: page.icon ?? null,
          position: page.position,
          parentPath,
          createdAt: page.createdAt?.toISOString() ?? new Date().toISOString(),
          updatedAt: page.updatedAt?.toISOString() ?? new Date().toISOString(),
        };

        if (childPages.length > 0) {
          const pageFolder = folder.folder(pageTitle);
          stack.push({ folder: pageFolder, parentPageId: page.id });
        }
      }
    }

    const metadata: ExportMetadata = {
      exportedAt: new Date().toISOString(),
      source: 'docmost',
      version: this.appVersion,
      pages: pagesMetadata,
    };

    zip.file('docmost-metadata.json', JSON.stringify(metadata, null, 2));
  }

  async zipAttachments(prosemirrorJson: any, spaceId: string, zip: JSZip) {
    const attachmentIds = getAttachmentIds(prosemirrorJson);

    if (attachmentIds.length > 0) {
      const attachments = await this.db
        .selectFrom('attachments')
        .selectAll()
        .where('id', 'in', attachmentIds)
        .where('spaceId', '=', spaceId)
        .execute();

      await Promise.all(
        attachments.map(async (attachment) => {
          try {
            const fileBuffer = await this.storageService.read(
              attachment.filePath,
            );
            const filePath = `/files/${attachment.id}/${attachment.fileName}`;
            zip.file(filePath, fileBuffer);
          } catch (err) {
            this.logger.debug(`Attachment export error ${attachment.id}`, err);
          }
        }),
      );
    }
  }

  async turnPageMentionsToLinks(prosemirrorJson: any, workspaceId: string) {
    const doc = jsonToNode(prosemirrorJson);

    const pageMentionIds = [];

    doc.descendants((node: Node) => {
      if (node.type.name === 'mention' && node.attrs.entityType === 'page') {
        if (node.attrs.entityId) {
          pageMentionIds.push(node.attrs.entityId);
        }
      }
    });

    if (pageMentionIds.length < 1) {
      return prosemirrorJson;
    }

    const pages = await this.db
      .selectFrom('pages')
      .select(['id', 'slugId', 'title', 'creatorId', 'spaceId', 'workspaceId'])
      .select((eb) => this.pageRepo.withSpace(eb))
      .where('id', 'in', pageMentionIds)
      .where('workspaceId', '=', workspaceId)
      .execute();

    const pageMap = new Map(pages.map((page) => [page.id, page]));

    let editorState = EditorState.create({
      doc: doc,
    });

    const transaction = editorState.tr;

    let offset = 0;

    /**
     * Helper function to replace a mention node with a link node.
     */
    const replaceMentionWithLink = (
      node: Node,
      pos: number,
      title: string,
      slugId: string,
      spaceSlug: string,
    ) => {
      const linkTitle = title || 'untitled';
      const truncatedTitle = linkTitle?.substring(0, 70);
      const pageSlug = `${slugify(truncatedTitle)}-${slugId}`;

      // Create the link URL
      const link = `${this.environmentService.getAppUrl()}/s/${spaceSlug}/p/${pageSlug}`;

      // Create a link mark and a text node with that mark
      const linkMark = editorState.schema.marks.link.create({ href: link });
      const linkTextNode = editorState.schema.text(linkTitle, [linkMark]);

      // Calculate positions (adjusted by the current offset)
      const from = pos + offset;
      const to = pos + offset + node.nodeSize;

      // Replace the node in the transaction and update the offset
      transaction.replaceWith(from, to, linkTextNode);
      offset += linkTextNode.nodeSize - node.nodeSize;
    };

    // find and convert page mentions to links
    editorState.doc.descendants((node: Node, pos: number) => {
      // Check if the node is a page mention
      if (node.type.name === 'mention' && node.attrs.entityType === 'page') {
        const { entityId: pageId, slugId, label } = node.attrs;
        const page = pageMap.get(pageId);

        if (page) {
          replaceMentionWithLink(
            node,
            pos,
            page.title,
            page.slugId,
            page.space.slug,
          );
        } else {
          // if page is not found, default to  the node label and slugId
          replaceMentionWithLink(node, pos, label, slugId, 'undefined');
        }
      }
    });

    if (transaction.docChanged) {
      editorState = editorState.apply(transaction);
    }

    const updatedDoc = editorState.doc;

    return updatedDoc.toJSON();
  }
}
