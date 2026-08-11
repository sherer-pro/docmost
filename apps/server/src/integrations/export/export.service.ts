import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { jsonToHtml, jsonToNode } from '../../collaboration/collaboration.util';
import { ExportFormat } from './dto/export-dto';
import { Page, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../core/page-access/page-access.service';
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
  extractUserMentionIdsFromJson,
  getAttachmentIds,
  getProsemirrorContent,
} from '../../common/helpers/prosemirror/utils';
import {
  addHeadingNumbersToJson,
  getTransclusionReferenceKey,
  materializeTransclusionsForPresentation,
  TRANSCLUSION_LABEL_STYLE,
  type TransclusionPresentationStrings,
  htmlToMarkdown,
  collectPageEmbedPresentationReferences,
  detachTemplateContent,
  materializePageEmbedsForPresentation,
} from '@docmost/editor-ext/server';
import { getAppVersion } from '../../common/helpers/get-app-version';
import {
  getPageAiRole,
  getPageAssigneeId,
  getPageStakeholderIds,
  normalizePageSettings,
} from '../../core/page/utils/page-settings.utils';
import { HtmlPdfRendererService } from './html-pdf-renderer.service';
import * as cheerio from 'cheerio';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveClientDistPath } from '../../common/utils/client-dist-path';
import { TokenService } from '../../core/auth/services/token.service';
import { validate as isValidUuid } from 'uuid';
import { resolveHeadingNumberingEnabled } from '../../core/page/utils/heading-numbering-settings.utils';
import {
  DOCMOST_ARCHIVE_SCHEMA_VERSION,
  type DocmostArchiveAttachment,
  type DocmostArchiveDataV4,
  type DocmostArchiveDatabase,
  type DocmostArchiveDatabaseCell,
  type DocmostArchiveDatabaseProperty,
  type DocmostArchiveDatabaseRow,
  type DocmostArchiveDatabaseView,
  type DocmostArchiveDictionaryTerm,
  type DocmostArchiveLabel,
  type DocmostArchiveManifestV4,
  type DocmostArchivePage,
  type DocmostArchiveScope,
  type DocmostArchiveTransclusionSnapshot,
  type DocmostArchiveUserReference,
  type DocmostPortableSpaceSettings,
  PAGE_AI_ROLE,
  type PageAiRole,
} from '@docmost/api-contract';
import { sanitize } from 'sanitize-filename-ts';
import { collectReferencesFromPmJson } from '../../core/page/transclusion/utils/transclusion-prosemirror.util';
import { createHash } from 'node:crypto';
import { TransclusionService } from '../../core/page/transclusion/transclusion.service';
import { PageEmbedService } from '../../core/page/transclusion/page-embed.service';

const PAGE_STATUS_LABELS: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
};

const PAGE_AI_ROLE_LABELS: Record<
  PageAiRole,
  { key: string; fallback: string }
> = {
  [PAGE_AI_ROLE.NONE]: { key: 'None', fallback: 'None' },
  [PAGE_AI_ROLE.EDITOR]: {
    key: 'Editor',
    fallback: 'Editor',
  },
  [PAGE_AI_ROLE.COAUTHOR]: {
    key: 'Coauthor',
    fallback: 'Coauthor',
  },
  [PAGE_AI_ROLE.COAUTHOR_PLUS]: {
    key: 'Coauthor+',
    fallback: 'Coauthor+',
  },
  [PAGE_AI_ROLE.AUTHOR]: {
    key: 'Author',
    fallback: 'Author',
  },
};

const PAGE_CUSTOM_FIELD_LABEL_KEYS = [
  'Status',
  'Assignee',
  'Stakeholders',
  'AI role',
] as const;
type PageCustomFieldLabelKey = (typeof PAGE_CUSTOM_FIELD_LABEL_KEYS)[number];
type PageCustomFieldLabels = Record<PageCustomFieldLabelKey, string>;

const DEFAULT_PAGE_CUSTOM_FIELD_LABELS: PageCustomFieldLabels = {
  Status: 'Status',
  Assignee: 'Assignee',
  Stakeholders: 'Stakeholders',
  'AI role': 'AI role',
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
    private readonly tokenService: TokenService,
    private readonly pageAccessService: PageAccessService,
    private readonly transclusionService: TransclusionService,
    private readonly pageEmbedService: PageEmbedService,
  ) {}

  async exportPage(
    format: string,
    page: Page,
    singlePage?: boolean,
    locale?: string,
    spaceHeadingNumberingEnabled?: boolean,
    spaceAiRoleEnabled?: boolean,
    authorizedUser?: User,
    preMaterializedAttachmentPageIds?: ReadonlySet<string>,
  ) {
    const {
      title: pageTitle,
      pageHtml,
      attachmentPageIds,
      attachmentIds,
    } = await this.buildPageExportHtml(
      page,
      singlePage,
      spaceHeadingNumberingEnabled,
      authorizedUser,
      locale,
      preMaterializedAttachmentPageIds,
    );

    if (format === ExportFormat.HTML) {
      return `<!DOCTYPE html>
      <html>
        <head>
         <title>${pageTitle}</title>
         <style>
           [data-docmost-transclusion="true"] { break-inside: avoid; }
           [data-docmost-transclusion-label="true"] { line-height: 1.4; }
         </style>
        </head>
        <body>${pageHtml}</body>
      </html>`;
    }

    if (format === ExportFormat.Markdown) {
      return htmlToMarkdown(pageHtml, {
        transclusion: this.resolveTransclusionPresentationStrings(locale),
      });
    }

    if (format === ExportFormat.PDF) {
      const pagePdfBody = await this.buildPagePdfBody({
        page,
        locale,
        singlePage,
        pageHtml,
        attachmentPageIds,
        attachmentIds,
        spaceAiRoleEnabled,
        authorizedUser,
      });

      return this.renderPdfFromHtmlDocument({
        title: pagePdfBody.title,
        bodyHtml: pagePdfBody.bodyHtml,
        attachmentTokens: pagePdfBody.attachmentTokens,
      });
    }

    return;
  }

  async buildPagePdfBody(params: {
    page: Page;
    locale?: string;
    singlePage?: boolean;
    pageHtml?: string;
    spaceAiRoleEnabled?: boolean;
    authorizedUser?: User;
    attachmentPageIds?: string[];
    attachmentIds?: string[];
  }): Promise<{
    title: string;
    bodyHtml: string;
    attachmentTokens: Record<string, string>;
  }> {
    const pageTitle = getPageTitle(params.page.title);
    let pageHtml = params.pageHtml;
    let attachmentPageIds = params.attachmentPageIds;
    let attachmentIds = params.attachmentIds;

    if (!pageHtml) {
      const pageHtmlResult = await this.buildPageExportHtml(
        params.page,
        params.singlePage,
        undefined,
        params.authorizedUser,
        params.locale,
      );
      pageHtml = pageHtmlResult.pageHtml;
      attachmentPageIds = pageHtmlResult.attachmentPageIds;
      attachmentIds = pageHtmlResult.attachmentIds;
    }

    const metadataRows = await this.resolvePageMetadataRows(
      params.page,
      params.locale,
      params.spaceAiRoleEnabled,
    );
    const allowedPageIds = new Set(attachmentPageIds ?? [params.page.id]);
    const bodyHtml = await this.buildPagePdfBodyHtml(
      pageHtml,
      metadataRows,
      params.page,
      allowedPageIds,
    );
    const attachmentTokens = await this.createPdfAttachmentTokens(
      [
        ...new Set([
          ...(attachmentIds ?? []),
          ...this.extractAttachmentIdsFromHtml(bodyHtml),
        ]),
      ],
      allowedPageIds,
      params.page.workspaceId,
    );
    const inlinedBodyHtml = await this.inlineAuthorizedPdfRasterImages(
      bodyHtml,
      new Set(Object.keys(attachmentTokens)),
      params.page.workspaceId,
    );

    return {
      title: pageTitle,
      bodyHtml: inlinedBodyHtml,
      attachmentTokens,
    };
  }

  private async buildPageExportHtml(
    page: Page,
    singlePage?: boolean,
    spaceHeadingNumberingEnabled?: boolean,
    authorizedUser?: User,
    locale?: string,
    preMaterializedAttachmentPageIds?: ReadonlySet<string>,
  ): Promise<{
    title: string;
    pageHtml: string;
    attachmentPageIds: string[];
    attachmentIds: string[];
  }> {
    const titleNode = {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: getPageTitle(page.title) }],
    };

    const materialized = preMaterializedAttachmentPageIds
      ? {
          content: getProsemirrorContent(page.content),
          attachmentPageIds: new Set([
            page.id,
            ...preMaterializedAttachmentPageIds,
          ]),
        }
      : await this.materializeTransclusionsWithAccess(
          getProsemirrorContent(page.content),
          authorizedUser,
          locale,
          page.id,
        );
    let prosemirrorJson: any = materialized.content;

    if (singlePage) {
      prosemirrorJson = await this.turnPageMentionsToLinks(
        prosemirrorJson,
        page.workspaceId,
      );
    }

    const headingNumberingEnabled =
      typeof spaceHeadingNumberingEnabled === 'boolean'
        ? spaceHeadingNumberingEnabled
        : await this.getSpaceHeadingNumberingDefault(page.spaceId);
    if (headingNumberingEnabled) {
      prosemirrorJson = addHeadingNumbersToJson(prosemirrorJson);
    }

    if (page.title) {
      prosemirrorJson.content.unshift(titleNode);
    }

    const pageHtml = this.decorateTransclusionHtml(
      this.removeColgroupTags(jsonToHtml(prosemirrorJson)),
      this.resolveTransclusionPresentationStrings(locale),
    );

    return {
      title: getPageTitle(page.title),
      pageHtml,
      attachmentPageIds: Array.from(materialized.attachmentPageIds),
      attachmentIds: getAttachmentIds(prosemirrorJson),
    };
  }

  private async materializeTransclusions(
    prosemirrorJson: unknown,
    authorizedUser?: User,
    locale?: string,
    referencePageId?: string,
  ): Promise<unknown> {
    return (
      await this.materializeTransclusionsWithAccess(
        prosemirrorJson,
        authorizedUser,
        locale,
        referencePageId,
      )
    ).content;
  }

  private async materializeTransclusionsWithAccess(
    prosemirrorJson: unknown,
    authorizedUser?: User,
    locale?: string,
    referencePageId?: string,
  ): Promise<{ content: unknown; attachmentPageIds: Set<string> }> {
    const materializedTemplateContent = detachTemplateContent(prosemirrorJson);
    const attachmentPageIds = new Set<string>();
    if (referencePageId) attachmentPageIds.add(referencePageId);
    const pageResolutions = new Map<
      string,
      { content?: unknown; status?: string }
    >();
    if (authorizedUser) {
      let frontier = collectPageEmbedPresentationReferences(
        materializedTemplateContent,
      );
      for (
        let depth = 0;
        depth < this.environmentService.getMaxPageEmbedDepth();
        depth += 1
      ) {
        frontier = frontier.filter(
          (sourcePageId) => !pageResolutions.has(sourcePageId),
        );
        if (frontier.length === 0) break;
        const result = await this.pageEmbedService.lookup(
          frontier,
          authorizedUser,
          referencePageId,
        );
        const next = new Set<string>();
        for (const item of result.items) {
          const resolution =
            'content' in item
              ? { content: item.content }
              : { status: item.status };
          pageResolutions.set(item.sourcePageId, resolution);
          if ('content' in item) {
            attachmentPageIds.add(item.sourcePageId);
            collectPageEmbedPresentationReferences(item.content).forEach((id) =>
              next.add(id),
            );
          }
        }
        frontier = Array.from(next);
      }
    }

    const pageMaterialized = materializePageEmbedsForPresentation(
      materializedTemplateContent,
      pageResolutions,
      this.resolveTransclusionPresentationStrings(locale).unavailable,
      this.environmentService.getMaxPageEmbedDepth(),
    );
    const references = collectReferencesFromPmJson(pageMaterialized);
    const resolutions = new Map<
      string,
      { content?: unknown; status?: string }
    >();

    if (authorizedUser && references.length > 0) {
      const result = await this.transclusionService.lookup(
        references,
        authorizedUser,
      );
      for (const item of result.items) {
        if ('content' in item) attachmentPageIds.add(item.sourcePageId);
        resolutions.set(
          getTransclusionReferenceKey(item.sourcePageId, item.transclusionId),
          'content' in item
            ? { content: item.content }
            : { status: item.status },
        );
      }
    }

    return {
      content: materializeTransclusionsForPresentation(
        pageMaterialized,
        resolutions,
        this.resolveTransclusionPresentationStrings(locale),
      ),
      attachmentPageIds,
    };
  }

  async prepareProsemirrorForExport(
    prosemirrorJson: unknown,
    workspaceId: string,
    authorizedUser: User,
    locale?: string,
    referencePageId?: string,
  ): Promise<unknown> {
    const materializedJson = await this.materializeTransclusions(
      prosemirrorJson,
      authorizedUser,
      locale,
      referencePageId,
    );

    return this.turnPageMentionsToLinks(materializedJson, workspaceId);
  }

  private resolveTransclusionPresentationStrings(
    locale?: string,
  ): TransclusionPresentationStrings {
    const fallbacks: TransclusionPresentationStrings = {
      label: 'Synced block',
      unavailable: 'Content unavailable',
    };
    const keys: Record<keyof TransclusionPresentationStrings, string> = {
      label: 'Synced block',
      unavailable: 'Synced block content unavailable',
    };
    const resolved = { ...fallbacks };
    const unresolved = new Set<keyof TransclusionPresentationStrings>([
      'label',
      'unavailable',
    ]);

    for (const localeCandidate of this.buildLocaleFallbackChain(locale)) {
      const translations = this.readLocaleTranslations(localeCandidate);
      if (!translations) continue;

      for (const name of Object.keys(keys) as Array<
        keyof TransclusionPresentationStrings
      >) {
        if (!unresolved.has(name)) continue;
        const value = this.readTranslationString(translations, keys[name]);
        if (value) {
          resolved[name] = value;
          unresolved.delete(name);
        }
      }
    }

    return resolved;
  }

  private decorateTransclusionHtml(
    html: string,
    strings: TransclusionPresentationStrings,
  ): string {
    const $ = cheerio.load(html, null, false);

    $('[data-docmost-transclusion="true"]').each((_index, element) => {
      const container = $(element);
      if (container.children('[data-docmost-transclusion-label]').length > 0) {
        return;
      }

      const label = $('<div></div>')
        .attr('data-docmost-transclusion-label', 'true')
        .attr('style', TRANSCLUSION_LABEL_STYLE)
        .text(strings.label);
      const content = container.children('[data-docmost-transclusion-content]');
      if (content.length > 0) {
        content.first().before(label);
      } else {
        container.prepend(label);
      }
    });

    return $.root().html() ?? html;
  }

  private async getSpaceHeadingNumberingDefault(
    spaceId: string,
  ): Promise<boolean> {
    const settings = await this.getSpaceSettings(spaceId);

    return resolveHeadingNumberingEnabled(settings);
  }

  private async getSpaceSettings(spaceId: string): Promise<unknown> {
    const space = await this.db
      .selectFrom('spaces')
      .select('settings')
      .where('id', '=', spaceId)
      .executeTakeFirst();

    return space?.settings;
  }

  private resolveSpaceAiRoleEnabled(settings: unknown): boolean {
    if (!settings || typeof settings !== 'object') {
      return false;
    }

    const documentFields = (settings as Record<string, unknown>)[
      'documentFields'
    ];

    return Boolean(
      documentFields &&
        typeof documentFields === 'object' &&
        (documentFields as Record<string, unknown>)['aiRole'],
    );
  }

  private async getSpaceAiRoleEnabled(spaceId: string): Promise<boolean> {
    return this.resolveSpaceAiRoleEnabled(await this.getSpaceSettings(spaceId));
  }

  async renderPdfFromHtmlDocument(params: {
    title: string;
    bodyHtml: string;
    attachmentToken?: string;
    attachmentTokens?: Record<string, string>;
  }): Promise<Buffer> {
    const htmlDocument = this.buildPdfHtmlDocument(
      params.title,
      params.bodyHtml,
    );
    return this.htmlPdfRendererService.render(htmlDocument, {
      attachmentToken: params.attachmentToken,
      attachmentTokens: params.attachmentTokens,
    });
  }

  private async createPdfAttachmentTokens(
    attachmentIds: string[],
    allowedPageIds: Set<string>,
    workspaceId: string,
  ): Promise<Record<string, string>> {
    const uniqueIds = [...new Set(attachmentIds)].filter(isValidUuid);
    if (uniqueIds.length === 0) return {};
    const attachments = await this.db
      .selectFrom('attachments')
      .select(['id', 'pageId'])
      .where('id', 'in', uniqueIds)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
    const entries = await Promise.all(
      attachments
        .filter(
          (attachment): attachment is typeof attachment & { pageId: string } =>
            Boolean(attachment.pageId && allowedPageIds.has(attachment.pageId)),
        )
        .map(
          async (attachment) =>
            [
              attachment.id,
              await this.tokenService.generateAttachmentToken({
                attachmentId: attachment.id,
                pageId: attachment.pageId,
                workspaceId,
              }),
            ] as const,
        ),
    );
    return Object.fromEntries(entries);
  }

  private extractAttachmentIdsFromHtml(html: string): string[] {
    const ids = new Set<string>();
    const pattern =
      /\/api\/(?:attachments\/files|files)(?:\/public)?\/([0-9a-f-]{36})(?:\/|[?"'])/gi;
    for (const match of html.matchAll(pattern)) {
      if (isValidUuid(match[1])) ids.add(match[1]);
    }
    return Array.from(ids);
  }

  private async inlineAuthorizedPdfRasterImages(
    html: string,
    authorizedAttachmentIds: Set<string>,
    workspaceId: string,
  ): Promise<string> {
    if (authorizedAttachmentIds.size === 0) return html;

    const $ = cheerio.load(`<div data-docmost-pdf-root>${html}</div>`);
    const root = $('[data-docmost-pdf-root]');
    const imageNodesByAttachmentId = new Map<string, cheerio.Cheerio<any>[]>();

    root.find('img[src]').each((_, node) => {
      const image = $(node);
      const attachmentId = this.extractAttachmentIdFromUrl(
        image.attr('src') || '',
      );
      if (!attachmentId || !authorizedAttachmentIds.has(attachmentId)) return;

      const images = imageNodesByAttachmentId.get(attachmentId) ?? [];
      images.push(image);
      imageNodesByAttachmentId.set(attachmentId, images);
    });

    const attachmentIds = Array.from(imageNodesByAttachmentId.keys());
    if (attachmentIds.length === 0) return html;

    const attachments = await this.db
      .selectFrom('attachments')
      .select(['id', 'filePath', 'mimeType'])
      .where('id', 'in', attachmentIds)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    const allowedMimeTypes = new Set([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ]);

    await Promise.all(
      attachments.map(async (attachment) => {
        const mimeType = attachment.mimeType?.trim().toLowerCase();
        if (
          !attachment.filePath ||
          !mimeType ||
          !allowedMimeTypes.has(mimeType)
        ) {
          return;
        }

        try {
          const fileBuffer = await this.storageService.read(
            attachment.filePath,
          );
          const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
          for (const image of imageNodesByAttachmentId.get(attachment.id) ??
            []) {
            image.attr('src', dataUrl);
          }
        } catch (err) {
          this.logger.debug(
            `Failed to inline raster attachment ${attachment.id} for PDF export`,
            err,
          );
        }
      }),
    );

    return root.html() || '';
  }

  private removeColgroupTags(html: string): string {
    return html.replace(/<colgroup[^>]*>[\s\S]*?<\/colgroup>/gim, '');
  }

  private buildPdfHtmlDocument(title: string, bodyHtml: string): string {
    const appUrl = this.ensureTrailingSlash(
      this.environmentService.getAppUrl(),
    );
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <base href="${this.escapeHtml(appUrl)}" />
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
      [data-docmost-transclusion="true"] {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      [data-docmost-transclusion-label="true"] {
        line-height: 1.4;
      }
      .page-break,
      [data-type="pageBreak"] {
        display: block;
        height: 0;
        margin: 0;
        break-after: page;
        page-break-after: always;
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
        font-size: 9px;
      }
      th,
      td {
        border: 1px solid #d1d5db;
        padding: 5px;
        text-align: left;
        vertical-align: top;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      th {
        background: #f9fafb;
        font-weight: 600;
      }
      thead {
        display: table-header-group;
      }
      tr {
        break-inside: avoid;
        page-break-inside: avoid;
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
      .docmost-diagram-image,
      .docmost-mermaid-figure svg {
        max-width: 100%;
        height: auto;
      }
      .docmost-mermaid-figure {
        margin: 0.75em 0;
        padding: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <main class="docmost-export-root">${bodyHtml}</main>
  </body>
</html>`;
  }

  private async buildPagePdfBodyHtml(
    pageHtml: string,
    metadataRows: Array<{ label: string; value: string }>,
    page: Pick<Page, 'workspaceId'>,
    allowedPageIds: Set<string>,
  ): Promise<string> {
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

    const pageContentHtml = await this.applyPdfCustomBlockFallbacks(
      pageHtml,
      page,
      allowedPageIds,
    );

    return `${metadataBlock}<article class="docmost-page-content">${pageContentHtml}</article>`;
  }

  private async resolvePageMetadataRows(
    page: Page,
    locale?: string,
    spaceAiRoleEnabled?: boolean,
  ): Promise<Array<{ label: string; value: string }>> {
    const settings = normalizePageSettings(page.settings);
    const statusLabel = this.resolvePageStatusLabel(settings.status);
    const assigneeId = getPageAssigneeId(settings);
    const stakeholderIds = getPageStakeholderIds(settings);
    const userIds = [
      ...new Set([...(assigneeId ? [assigneeId] : []), ...stakeholderIds]),
    ];
    const userNameById = await this.resolveUserNameMap(
      userIds,
      page.workspaceId,
    );
    const metadataLabels = this.resolvePageCustomFieldLabels(locale);
    const rows: Array<{ label: string; value: string }> = [];
    const aiRoleEnabled =
      spaceAiRoleEnabled ?? (await this.getSpaceAiRoleEnabled(page.spaceId));

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

    if (aiRoleEnabled) {
      rows.push({
        label: metadataLabels['AI role'],
        value: this.resolvePageAiRoleLabel(getPageAiRole(settings), locale),
      });
    }

    return rows;
  }

  private resolvePageAiRoleLabel(value: PageAiRole, locale?: string): string {
    const label = PAGE_AI_ROLE_LABELS[value];

    for (const localeCandidate of this.buildLocaleFallbackChain(locale)) {
      const translations = this.readLocaleTranslations(localeCandidate);
      const translatedLabel = translations
        ? this.readTranslationString(translations, label.key)
        : null;

      if (translatedLabel) {
        return translatedLabel;
      }
    }

    return label.fallback;
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

    for (const localeCandidate of this.buildLocaleFallbackChain(
      normalizedLocale,
    )) {
      const translations = this.readLocaleTranslations(localeCandidate);
      if (!translations) {
        continue;
      }

      for (const labelKey of PAGE_CUSTOM_FIELD_LABEL_KEYS) {
        if (!unresolvedLabels.has(labelKey)) {
          continue;
        }

        const translatedLabel = this.readTranslationString(
          translations,
          labelKey,
        );
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

    this.availableClientLocalesCache = [...discoveredLocales].sort(
      (left, right) => left.localeCompare(right, 'en'),
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

  private readLocaleTranslations(
    locale: string,
  ): Record<string, unknown> | null {
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
      .map(
        (token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
      )
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

  private async applyPdfCustomBlockFallbacks(
    pageHtml: string,
    page: Pick<Page, 'workspaceId'>,
    allowedPageIds: Set<string>,
  ): Promise<string> {
    const $ = cheerio.load(
      `<div class="docmost-page-content-root">${pageHtml}</div>`,
    );
    const root = $('.docmost-page-content-root');
    this.normalizePdfResourceUrls($, root);

    root.find('div[data-type="linkPreview"]').each((_, node) => {
      const previewNode = $(node);
      const url = this.normalizePdfUrl(
        this.readHtmlAttribute(previewNode, ['url', 'data-url']),
      );
      const title = this.readHtmlAttribute(previewNode, [
        'title',
        'data-title',
      ]);
      const description = this.readHtmlAttribute(previewNode, [
        'description',
        'data-description',
      ]);
      const image = this.normalizePdfUrl(
        this.readHtmlAttribute(previewNode, ['image', 'data-image']),
      );
      const siteName = this.readHtmlAttribute(previewNode, [
        'siteName',
        'data-site-name',
      ]);

      const previewCard = $('<section></section>').addClass(
        'docmost-link-preview-block',
      );

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

    root.find('iframe').each((_, node) => {
      const iframe = $(node);
      const src = this.normalizePdfUrl(iframe.attr('src') || '');
      const isAttachment = Boolean(this.extractAttachmentIdFromUrl(src));
      const fallback = $('<section></section>').addClass('docmost-embed-card');
      fallback.append(
        $('<p></p>')
          .addClass('docmost-fallback-title')
          .text(isAttachment ? 'PDF attachment' : 'Embedded content'),
      );
      if (src) {
        fallback.append(
          $('<a></a>')
            .addClass('docmost-fallback-link')
            .attr('href', src)
            .attr('target', '_blank')
            .attr('rel', 'noopener noreferrer')
            .text(src),
        );
      }
      iframe.replaceWith(fallback);
    });

    const diagramNodes = root
      .find('div[data-type="drawio"], div[data-type="excalidraw"]')
      .toArray();

    for (const node of diagramNodes) {
      const diagramNode = $(node);
      const src = this.readHtmlAttribute(diagramNode, ['data-src', 'src']);
      const attachmentId = this.readHtmlAttribute(diagramNode, [
        'data-attachment-id',
        'attachmentId',
      ]);
      const title = this.readHtmlAttribute(diagramNode, [
        'data-title',
        'title',
      ]);
      const typeName = this.readHtmlAttribute(diagramNode, ['data-type']);
      const normalizedTypeName =
        typeName === 'drawio' ? 'Draw.io diagram' : 'Excalidraw diagram';
      const existingImage = diagramNode.find('img').first();
      const diagramSource = await this.resolvePdfDiagramSource({
        src,
        attachmentId,
        diagramType: typeName,
        workspaceId: page.workspaceId,
        allowedPageIds,
      });
      const normalizedSrc = diagramSource.src;
      const inlineSvgHtml = diagramSource.inlineSvgHtml;

      if (existingImage.length > 0) {
        if (inlineSvgHtml) {
          diagramNode.removeAttr('data-src').removeAttr('src');
          existingImage.replaceWith(inlineSvgHtml);
          continue;
        }

        if (normalizedSrc) {
          existingImage.attr('src', normalizedSrc);
        }
        if (!existingImage.attr('alt')) {
          existingImage.attr('alt', title || normalizedTypeName);
        }
        existingImage.addClass('docmost-diagram-image');
        continue;
      }

      if (!normalizedSrc && !inlineSvgHtml) {
        const fallback = $('<section></section>').addClass(
          'docmost-diagram-fallback',
        );
        fallback.append(
          $('<p></p>')
            .addClass('docmost-fallback-title')
            .text(title || normalizedTypeName),
        );
        diagramNode.replaceWith(fallback);
        continue;
      }

      const renderedDiagram = $('<section></section>').addClass(
        'docmost-diagram-fallback',
      );
      if (inlineSvgHtml) {
        renderedDiagram.append(inlineSvgHtml);
      } else {
        renderedDiagram.append(
          $('<img />')
            .addClass('docmost-diagram-image')
            .attr('src', normalizedSrc)
            .attr('alt', title || normalizedTypeName),
        );
      }
      if (title) {
        renderedDiagram.append(
          $('<p></p>').addClass('docmost-fallback-title').text(title),
        );
      }

      diagramNode.replaceWith(renderedDiagram);
    }

    root.find('div[data-type="subpages"]').each((_, node) => {
      const subpagesNode = $(node);
      const fallback = $('<section></section>').addClass(
        'docmost-subpages-fallback',
      );

      fallback.append(
        $('<p></p>').addClass('docmost-fallback-title').text('Subpages block'),
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

  private async resolvePdfDiagramSource(params: {
    src: string;
    attachmentId?: string;
    diagramType?: string;
    workspaceId: string;
    allowedPageIds: Set<string>;
  }): Promise<{ src: string; inlineSvgHtml: string | null }> {
    const normalizedSrc = this.normalizePdfUrl(params.src);
    const attachmentId =
      this.normalizeAttachmentId(params.attachmentId) ||
      this.extractAttachmentIdFromUrl(normalizedSrc);

    if (!attachmentId) {
      return { src: normalizedSrc, inlineSvgHtml: null };
    }

    try {
      const attachment = await this.db
        .selectFrom('attachments')
        .select(['id', 'filePath', 'mimeType', 'pageId', 'deletedAt'])
        .where('id', '=', attachmentId)
        .where('workspaceId', '=', params.workspaceId)
        .executeTakeFirst();

      if (
        !attachment?.filePath ||
        attachment.deletedAt ||
        !attachment.pageId ||
        !params.allowedPageIds.has(attachment.pageId)
      ) {
        return { src: normalizedSrc, inlineSvgHtml: null };
      }

      const fileBuffer = await this.storageService.read(attachment.filePath);
      const mimeType = attachment.mimeType?.trim() || 'image/svg+xml';
      const inlineSvgHtml = this.tryBuildInlineSvgFromBuffer(
        fileBuffer,
        mimeType,
      );

      return {
        src: `data:${mimeType};base64,${fileBuffer.toString('base64')}`,
        inlineSvgHtml,
      };
    } catch (err) {
      this.logger.debug(
        `Failed to inline diagram attachment ${attachmentId} for PDF export`,
        err,
      );
      return { src: normalizedSrc, inlineSvgHtml: null };
    }
  }

  private tryBuildInlineSvgFromBuffer(
    fileBuffer: Buffer,
    mimeType: string,
  ): string | null {
    if (!mimeType.toLowerCase().includes('svg')) {
      return null;
    }

    const svgContent = fileBuffer.toString('utf8');
    if (!svgContent.includes('<svg')) {
      return null;
    }

    const $ = cheerio.load(svgContent, { xmlMode: true });
    const svgNode = $('svg').first();
    if (!svgNode.length) {
      return null;
    }

    // Drop scripts and inline event handlers before embedding into export HTML.
    svgNode.find('script').remove();
    const svgElements = [svgNode.get(0), ...svgNode.find('*').toArray()].filter(
      Boolean,
    );
    for (const childNode of svgElements) {
      const child = $(childNode);
      const attributes = child.attr() || {};
      for (const attributeName of Object.keys(attributes)) {
        if (attributeName.toLowerCase().startsWith('on')) {
          child.removeAttr(attributeName);
        }
      }
    }

    svgNode.addClass('docmost-diagram-image');
    return $.xml(svgNode);
  }

  private normalizeAttachmentId(value?: string): string | null {
    const candidate = value?.trim();
    if (!candidate || !isValidUuid(candidate)) {
      return null;
    }

    return candidate;
  }

  private extractAttachmentIdFromUrl(url?: string): string | null {
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url, this.environmentService.getAppUrl());
      const match = parsed.pathname.match(
        /\/(?:api\/)?(?:attachments\/files(?:\/public)?|files(?:\/public)?)\/([0-9a-fA-F-]{36})\//,
      );

      if (!match?.[1] || !isValidUuid(match[1])) {
        return null;
      }

      return match[1];
    } catch (err) {
      return null;
    }
  }

  private normalizePdfResourceUrls(
    $: cheerio.CheerioAPI,
    root: cheerio.Cheerio<any>,
  ): void {
    root.find('[src], [href], [poster], [data-src]').each((_, node) => {
      const htmlNode = $(node);
      this.rewriteHtmlUrlAttribute(htmlNode, 'src');
      this.rewriteHtmlUrlAttribute(htmlNode, 'href', true);
      this.rewriteHtmlUrlAttribute(htmlNode, 'poster');
      this.rewriteHtmlUrlAttribute(htmlNode, 'data-src');
    });
  }

  private rewriteHtmlUrlAttribute(
    node: cheerio.Cheerio<any>,
    attributeName: string,
    onlyAttachments = false,
  ): void {
    const attrValue = node.attr(attributeName);
    if (!attrValue?.trim()) {
      return;
    }

    if (onlyAttachments && !this.isAttachmentUrlLike(attrValue)) {
      return;
    }

    node.attr(attributeName, this.normalizePdfUrl(attrValue));
  }

  private normalizePdfUrl(url: string): string {
    const normalizedUrl = url?.trim();
    if (!normalizedUrl || this.shouldSkipPdfUrlNormalization(normalizedUrl)) {
      return normalizedUrl;
    }

    let parsed: URL;
    try {
      parsed = new URL(normalizedUrl, this.environmentService.getAppUrl());
    } catch (err) {
      return normalizedUrl;
    }

    if (this.isAttachmentFilePath(parsed.pathname)) {
      parsed.pathname = this.rewriteAttachmentPathToPublic(parsed.pathname);
      parsed.searchParams.delete('jwt');
    }

    return parsed.toString();
  }

  private shouldSkipPdfUrlNormalization(url: string): boolean {
    const lowerCaseUrl = url.toLowerCase();
    return (
      lowerCaseUrl.startsWith('data:') ||
      lowerCaseUrl.startsWith('blob:') ||
      lowerCaseUrl.startsWith('mailto:') ||
      lowerCaseUrl.startsWith('tel:') ||
      lowerCaseUrl.startsWith('javascript:') ||
      lowerCaseUrl.startsWith('#')
    );
  }

  private isAttachmentFilePath(pathname: string): boolean {
    return (
      pathname.startsWith('/api/files/') ||
      pathname.startsWith('/files/') ||
      pathname.startsWith('/api/attachments/files/') ||
      pathname.startsWith('/attachments/files/')
    );
  }

  private isAttachmentUrlLike(url: string): boolean {
    const normalizedUrl = url?.trim();
    if (!normalizedUrl || this.shouldSkipPdfUrlNormalization(normalizedUrl)) {
      return false;
    }

    try {
      const parsed = new URL(
        normalizedUrl,
        this.environmentService.getAppUrl(),
      );
      return this.isAttachmentFilePath(parsed.pathname);
    } catch (err) {
      return false;
    }
  }

  private rewriteAttachmentPathToPublic(pathname: string): string {
    if (
      pathname.startsWith('/api/files/public/') ||
      pathname.startsWith('/files/public/') ||
      pathname.startsWith('/api/attachments/files/public/') ||
      pathname.startsWith('/attachments/files/public/')
    ) {
      return pathname;
    }

    if (pathname.startsWith('/api/attachments/files/')) {
      return pathname.replace(
        '/api/attachments/files/',
        '/api/attachments/files/public/',
      );
    }

    if (pathname.startsWith('/attachments/files/')) {
      return pathname.replace(
        '/attachments/files/',
        '/attachments/files/public/',
      );
    }

    if (pathname.startsWith('/api/files/')) {
      return pathname.replace('/api/files/', '/api/files/public/');
    }

    if (pathname.startsWith('/files/')) {
      return pathname.replace('/files/', '/files/public/');
    }

    return pathname;
  }

  private ensureTrailingSlash(url: string): string {
    if (!url) {
      return '/';
    }

    return url.endsWith('/') ? url : `${url}/`;
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

  /**
   * Keeps only the pages the user may read, walking down from the export root.
   *
   * A denied page prunes its whole subtree: that keeps the archive structurally
   * consistent (no page referencing a parent that was dropped) and avoids
   * leaking titles of restricted branches.
   */
  private async filterReadablePages(
    pages: Page[],
    rootPageId: string,
    user: User,
  ): Promise<Page[]> {
    const accessByPageId =
      await this.pageAccessService.getEffectiveAccessForPages(pages, user);

    const childrenByParentId = new Map<string, Page[]>();
    for (const page of pages) {
      if (!page.parentPageId) {
        continue;
      }
      const siblings = childrenByParentId.get(page.parentPageId) ?? [];
      siblings.push(page);
      childrenByParentId.set(page.parentPageId, siblings);
    }

    const rootPage = pages.find((page) => page.id === rootPageId) ?? pages[0];
    const readablePages: Page[] = [];
    const queue: Page[] = rootPage ? [rootPage] : [];

    while (queue.length > 0) {
      const page = queue.shift();

      if (!accessByPageId.get(page.id)?.capabilities.canRead) {
        continue;
      }

      readablePages.push(page);
      queue.push(...(childrenByParentId.get(page.id) ?? []));
    }

    return readablePages;
  }

  /**
   * @param authorizedUser When provided, every descendant page is filtered
   *   through the page access rules for this user. Callers that authorize only
   *   the root page must pass it, otherwise a subtree the user is denied would
   *   still be serialized into the archive.
   */
  async exportPages(
    pageId: string,
    format: string,
    includeAttachments: boolean,
    includeChildren: boolean,
    locale?: string,
    headingNumberingByPageId?: Record<string, boolean>,
    authorizedUser?: User,
    allowedPageIds?: Set<string>,
  ) {
    let pages: Page[];

    if (includeChildren) {
      //@ts-ignore
      pages = await this.pageRepo.getPageAndDescendants(pageId, {
        includeContent: true,
      });

      if (authorizedUser) {
        pages = await this.filterReadablePages(pages, pageId, authorizedUser);
      }
      if (allowedPageIds) {
        pages = pages.filter((page) => allowedPageIds.has(page.id));
        const retainedPageIds = new Set(pages.map((page) => page.id));
        pages = pages.map((page) =>
          page.id !== pageId &&
          page.parentPageId &&
          !retainedPageIds.has(page.parentPageId)
            ? { ...page, parentPageId: pageId }
            : page,
        );
      }
    } else {
      // Only fetch the single page when includeChildren is false
      const page = await this.pageRepo.findById(pageId, {
        includeContent: true,
      });
      if (page) {
        pages = !allowedPageIds || allowedPageIds.has(page.id) ? [page] : [];
      }
    }

    if (!pages || pages.length === 0) {
      throw new BadRequestException('No pages to export');
    }

    if (format === ExportFormat.Docmost) {
      if (!authorizedUser) {
        throw new BadRequestException(
          'Authorized user is required for Docmost archive export',
        );
      }
      const rootPage = pages.find((page) => page.id === pageId) ?? pages[0];
      const zip = await this.createDocmostArchive({
        scope: 'page',
        displayName: getPageTitle(rootPage.title),
        spaceId: rootPage.spaceId,
        pages,
        rootPageId: pageId,
        authorizedUser,
      });

      return zip.generateNodeStream({
        type: 'nodebuffer',
        streamFiles: true,
        compression: 'DEFLATE',
      });
    }

    const spaceSettings = await this.getSpaceSettings(pages[0].spaceId);
    const spaceHeadingNumberingEnabled =
      resolveHeadingNumberingEnabled(spaceSettings);
    const spaceAiRoleEnabled = this.resolveSpaceAiRoleEnabled(spaceSettings);

    const parentPageIndex = pages.findIndex((obj) => obj.id === pageId);
    // set to null to make export of pages with parentId work
    pages[parentPageIndex].parentPageId = null;

    const tree = buildTree(pages as Page[]);

    const zip = new JSZip();
    await this.zipPages(
      tree,
      format,
      zip,
      includeAttachments,
      locale,
      spaceHeadingNumberingEnabled,
      spaceAiRoleEnabled,
      headingNumberingByPageId,
      authorizedUser,
    );

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
    headingNumberingByPageId?: Record<string, boolean>,
    allowedPageIds?: Set<string>,
    authorizedUser?: User,
  ) {
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', spaceId)
      .executeTakeFirst();

    if (!space) {
      throw new NotFoundException('Space not found');
    }

    let pages = await this.db
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
        'pages.settings',
      ])
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .where('templateKind', 'is', null)
      .execute();
    if (allowedPageIds) {
      pages = pages.filter((page) => allowedPageIds.has(page.id));
    }

    if (format === ExportFormat.Docmost) {
      if (!authorizedUser) {
        throw new BadRequestException(
          'Authorized user is required for Docmost archive export',
        );
      }
      const zip = await this.createDocmostArchive({
        scope: 'space',
        displayName: space.name || 'space',
        spaceId,
        pages: pages as Page[],
        authorizedUser,
      });
      return {
        fileStream: zip.generateNodeStream({
          type: 'nodebuffer',
          streamFiles: true,
          compression: 'DEFLATE',
        }),
        fileName: `${space.name}-docmost-archive.zip`,
      };
    }

    const tree = buildTree(pages as Page[]);

    const zip = new JSZip();

    await this.zipPages(
      tree,
      format,
      zip,
      includeAttachments,
      locale,
      resolveHeadingNumberingEnabled(space.settings),
      this.resolveSpaceAiRoleEnabled(space.settings),
      headingNumberingByPageId,
      authorizedUser,
    );

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

  async exportDatabaseArchive(
    databaseId: string,
    authorizedUser: User,
  ): Promise<{
    fileStream: NodeJS.ReadableStream;
    fileName: string;
  }> {
    const database = await this.db
      .selectFrom('databases')
      .selectAll()
      .where('id', '=', databaseId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!database || !database.pageId) {
      throw new NotFoundException('Database not found');
    }

    let pages = (await this.pageRepo.getPageAndDescendants(database.pageId, {
      includeContent: true,
    })) as Page[];
    pages = await this.filterReadablePages(
      pages,
      database.pageId,
      authorizedUser,
    );
    const zip = await this.createDocmostArchive({
      scope: 'database',
      displayName: database.name,
      spaceId: database.spaceId,
      pages: pages as Page[],
      databaseId,
      rootPageId: database.pageId,
      authorizedUser,
    });

    return {
      fileStream: zip.generateNodeStream({
        type: 'nodebuffer',
        streamFiles: true,
        compression: 'DEFLATE',
      }),
      fileName: `${database.name}-docmost-archive.zip`,
    };
  }

  private async createDocmostArchive(params: {
    scope: DocmostArchiveScope;
    displayName: string;
    spaceId: string;
    pages: Page[];
    rootPageId?: string;
    databaseId?: string;
    authorizedUser: User;
  }): Promise<JSZip> {
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', params.spaceId)
      .executeTakeFirst();
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const initialPageIds = params.pages.map((page) => page.id);
    let databaseQuery = this.db
      .selectFrom('databases')
      .selectAll()
      .where('deletedAt', 'is', null);

    if (params.databaseId) {
      databaseQuery = databaseQuery.where('id', '=', params.databaseId);
    } else if (params.scope === 'space') {
      databaseQuery = databaseQuery.where('spaceId', '=', params.spaceId);
    } else if (initialPageIds.length > 0) {
      databaseQuery = databaseQuery.where('pageId', 'in', initialPageIds);
    } else {
      databaseQuery = databaseQuery.where(
        'id',
        '=',
        '00000000-0000-0000-0000-000000000000',
      );
    }

    const databaseRowsSource = await databaseQuery.execute();
    const databaseIds = databaseRowsSource.map((database) => database.id);
    const rowRecords =
      databaseIds.length > 0
        ? await this.db
            .selectFrom('databaseRows')
            .selectAll()
            .where('databaseId', 'in', databaseIds)
            .execute()
        : [];

    const pageMap = new Map(params.pages.map((page) => [page.id, page]));
    const missingRowPageIds = rowRecords
      .map((row) => row.pageId)
      .filter((pageId) => !pageMap.has(pageId));
    if (missingRowPageIds.length > 0) {
      const missingPages = await this.db
        .selectFrom('pages')
        .selectAll()
        .where('id', 'in', missingRowPageIds)
        .where('deletedAt', 'is', null)
        .execute();
      const accessByPageId =
        await this.pageAccessService.getEffectiveAccessForPages(
          missingPages as Page[],
          params.authorizedUser,
        );
      for (const page of missingPages) {
        if (!accessByPageId.get(page.id)?.capabilities.canRead) {
          continue;
        }
        pageMap.set(page.id, page as Page);
      }
    }
    const exportedRowRecords = rowRecords.filter((row) =>
      pageMap.has(row.pageId),
    );
    const exportedRowPageIds = new Set(
      exportedRowRecords.map((row) => row.pageId),
    );

    const pages = Array.from(pageMap.values());
    const pageIds = pages.map((page) => page.id);
    const pageIdSet = new Set(pageIds);
    const archivePages: DocmostArchivePage[] = pages.map((page) => ({
      id: page.id,
      slugId: page.slugId,
      title: page.title ?? null,
      icon: page.icon ?? null,
      position: page.position ?? null,
      parentPageId:
        page.id === params.rootPageId ||
        !page.parentPageId ||
        !pageIdSet.has(page.parentPageId)
          ? null
          : page.parentPageId,
      content: detachTemplateContent(getProsemirrorContent(page.content)),
      settings: normalizePageSettings(page.settings),
      templateKind:
        page.templateKind === 'regular' || page.templateKind === 'synced'
          ? page.templateKind
          : null,
    }));
    const transclusionSnapshots: DocmostArchiveTransclusionSnapshot[] = [];
    for (const page of archivePages) {
      const references = collectReferencesFromPmJson(page.content).filter(
        (reference) => !pageIdSet.has(reference.sourcePageId),
      );
      if (references.length === 0) continue;
      const lookup = await this.transclusionService.lookup(
        references,
        params.authorizedUser,
      );
      for (const item of lookup.items) {
        if (!('content' in item)) continue;
        transclusionSnapshots.push({
          referencePageId: page.id,
          sourcePageId: item.sourcePageId,
          transclusionId: item.transclusionId,
          content: item.content,
        });
      }
    }

    const [propertyRows, cellRows, viewRows] =
      databaseIds.length > 0
        ? await Promise.all([
            this.db
              .selectFrom('databaseProperties')
              .selectAll()
              .where('databaseId', 'in', databaseIds)
              .where('deletedAt', 'is', null)
              .execute(),
            this.db
              .selectFrom('databaseCells')
              .selectAll()
              .where('databaseId', 'in', databaseIds)
              .where('deletedAt', 'is', null)
              .execute(),
            this.db
              .selectFrom('databaseViews')
              .selectAll()
              .where('databaseId', 'in', databaseIds)
              .where('deletedAt', 'is', null)
              .execute(),
          ])
        : [[], [], []];

    const archiveDatabases: DocmostArchiveDatabase[] = databaseRowsSource.map(
      (database) => ({
        id: database.id,
        pageId:
          database.pageId && pageIdSet.has(database.pageId)
            ? database.pageId
            : null,
        name: database.name,
        description: database.description,
        descriptionContent: database.descriptionContent,
        icon: database.icon,
      }),
    );
    const archiveProperties: DocmostArchiveDatabaseProperty[] =
      propertyRows.map((property) => ({
        id: property.id,
        databaseId: property.databaseId,
        name: property.name,
        type: property.type,
        position: property.position,
        settings: property.settings,
      }));
    const exportedPropertyIds = new Set(
      archiveProperties.map((property) => property.id),
    );
    const archiveRows: DocmostArchiveDatabaseRow[] = exportedRowRecords.map(
      (row) => ({
        id: row.id,
        databaseId: row.databaseId,
        pageId: row.pageId,
        archived: Boolean(row.archivedAt),
      }),
    );
    const archiveCells: DocmostArchiveDatabaseCell[] = cellRows
      .filter(
        (cell) =>
          exportedRowPageIds.has(cell.pageId) &&
          exportedPropertyIds.has(cell.propertyId),
      )
      .map((cell) => ({
        id: cell.id,
        databaseId: cell.databaseId,
        pageId: cell.pageId,
        propertyId: cell.propertyId,
        attachmentId: cell.attachmentId,
        value: cell.value,
      }));
    const archiveViews: DocmostArchiveDatabaseView[] = viewRows.map((view) => ({
      id: view.id,
      databaseId: view.databaseId,
      name: view.name,
      type: view.type,
      config: view.config,
    }));

    const labelRows =
      pageIds.length > 0
        ? await this.db
            .selectFrom('pageLabels')
            .innerJoin('labels', 'labels.id', 'pageLabels.labelId')
            .select([
              'labels.id as id',
              'labels.name as name',
              'pageLabels.pageId as pageId',
            ])
            .where('labels.spaceId', '=', params.spaceId)
            .where('pageLabels.pageId', 'in', pageIds)
            .execute()
        : [];
    const labelsById = new Map<string, DocmostArchiveLabel>();
    for (const row of labelRows) {
      const label = labelsById.get(row.id) ?? {
        id: row.id,
        name: row.name,
        pageIds: [],
      };
      label.pageIds.push(row.pageId);
      labelsById.set(row.id, label);
    }

    const dictionary: DocmostArchiveDictionaryTerm[] = [];
    if (params.scope === 'space') {
      const terms = await this.db
        .selectFrom('dictionaryTerms')
        .selectAll()
        .where('spaceId', '=', params.spaceId)
        .where('deletedAt', 'is', null)
        .execute();
      const termIds = terms.map((term) => term.id);
      const aliases =
        termIds.length > 0
          ? await this.db
              .selectFrom('dictionaryTermAliases')
              .selectAll()
              .where('termId', 'in', termIds)
              .execute()
          : [];
      const aliasesByTermId = new Map<string, string[]>();
      for (const alias of aliases) {
        if (alias.isPrimary) continue;
        const forms = aliasesByTermId.get(alias.termId) ?? [];
        forms.push(alias.alias);
        aliasesByTermId.set(alias.termId, forms);
      }
      dictionary.push(
        ...terms.map((term) => ({
          term: term.term,
          forms: aliasesByTermId.get(term.id) ?? [],
          definitionMarkdown: term.definitionMarkdown,
        })),
      );
    }

    const attachmentIds = new Set<string>();
    const attachmentOwners = new Map<string, Set<string>>();
    const allowAttachment = (attachmentId: string, pageId: string | null) => {
      attachmentIds.add(attachmentId);
      if (!pageId) return;
      const owners = attachmentOwners.get(attachmentId) ?? new Set<string>();
      owners.add(pageId);
      attachmentOwners.set(attachmentId, owners);
    };
    for (const page of archivePages) {
      for (const attachmentId of getAttachmentIds(page.content)) {
        allowAttachment(attachmentId, page.id);
      }
    }
    for (const database of archiveDatabases) {
      if (
        database.descriptionContent &&
        typeof database.descriptionContent === 'object'
      ) {
        for (const attachmentId of getAttachmentIds(
          database.descriptionContent,
        )) {
          allowAttachment(attachmentId, database.pageId);
        }
      }
    }
    for (const snapshot of transclusionSnapshots) {
      for (const attachmentId of getAttachmentIds(snapshot.content)) {
        allowAttachment(attachmentId, snapshot.sourcePageId);
      }
    }
    for (const cell of archiveCells) {
      if (cell.attachmentId) allowAttachment(cell.attachmentId, cell.pageId);
    }
    const attachmentRows =
      attachmentIds.size > 0
        ? await this.db
            .selectFrom('attachments')
            .selectAll()
            .where('id', 'in', Array.from(attachmentIds))
            .where('workspaceId', '=', space.workspaceId)
            .where('deletedAt', 'is', null)
            .execute()
        : [];
    const authorizedAttachmentRows = attachmentRows.filter((attachment) =>
      Boolean(
        attachment.pageId &&
          attachmentOwners.get(attachment.id)?.has(attachment.pageId),
      ),
    );
    if (authorizedAttachmentRows.length !== attachmentIds.size) {
      const found = new Set(
        authorizedAttachmentRows.map((attachment) => attachment.id),
      );
      const missing = Array.from(attachmentIds).filter((id) => !found.has(id));
      throw new BadRequestException(
        `Cannot create lossless archive: missing attachments ${missing.join(', ')}`,
      );
    }

    const attachmentBuffers = new Map<string, Buffer>();
    await Promise.all(
      authorizedAttachmentRows.map(async (attachment) => {
        attachmentBuffers.set(
          attachment.id,
          await this.storageService.read(attachment.filePath),
        );
      }),
    );
    const archiveAttachments: DocmostArchiveAttachment[] =
      authorizedAttachmentRows.map((attachment) => {
        const safeFileName =
          sanitize(attachment.fileName) ||
          `${attachment.id}${attachment.fileExt || ''}`;
        const fileBuffer = attachmentBuffers.get(attachment.id)!;
        return {
          id: attachment.id,
          pageId: attachment.pageId,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          fileExt: attachment.fileExt,
          mimeType: attachment.mimeType,
          type: attachment.type,
          archivePath: `files/${attachment.id}/${safeFileName}`,
          sha256: createHash('sha256').update(fileBuffer).digest('hex'),
        };
      });

    const referencedIds = new Set<string>();
    for (const page of archivePages) {
      this.collectUuidStrings(page.settings, referencedIds);
      this.collectUuidStrings(page.content, referencedIds);
      for (const userId of extractUserMentionIdsFromJson(page.content)) {
        referencedIds.add(userId);
      }
    }
    for (const database of archiveDatabases) {
      this.collectUuidStrings(database.descriptionContent, referencedIds);
    }
    for (const snapshot of transclusionSnapshots) {
      this.collectUuidStrings(snapshot.content, referencedIds);
      for (const userId of extractUserMentionIdsFromJson(snapshot.content)) {
        referencedIds.add(userId);
      }
    }
    for (const cell of archiveCells) {
      this.collectUuidStrings(cell.value, referencedIds);
    }
    const userRows =
      referencedIds.size > 0
        ? await this.db
            .selectFrom('users')
            .select(['id', 'email', 'name'])
            .where('workspaceId', '=', space.workspaceId)
            .where('id', 'in', Array.from(referencedIds))
            .execute()
        : [];
    const users: DocmostArchiveUserReference[] = userRows.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
    }));

    const zip = new JSZip();
    const fallbackPages = pages.map((page) => ({
      ...page,
      parentPageId:
        page.id === params.rootPageId ||
        !page.parentPageId ||
        !pageIdSet.has(page.parentPageId)
          ? null
          : page.parentPageId,
    })) as Page[];
    await this.zipPages(
      buildTree(fallbackPages),
      ExportFormat.Markdown,
      zip,
      false,
      DEFAULT_EXPORT_LOCALE,
      resolveHeadingNumberingEnabled(space.settings),
      this.resolveSpaceAiRoleEnabled(space.settings),
      undefined,
      params.authorizedUser,
    );

    const legacyMetadataFile = zip.file('docmost-metadata.json');
    const legacyMetadata = legacyMetadataFile
      ? (JSON.parse(await legacyMetadataFile.async('string')) as ExportMetadata)
      : ({ pages: {} } as ExportMetadata);

    const portableSpaceSettings = this.getPortableSpaceSettings(space.settings);
    const data: DocmostArchiveDataV4 = {
      schemaVersion: DOCMOST_ARCHIVE_SCHEMA_VERSION,
      scope: params.scope,
      sourceSpace: {
        id: space.id,
        name: space.name,
        settings: portableSpaceSettings,
      },
      pages: archivePages,
      attachments: archiveAttachments,
      users,
      transclusionSnapshots,
      databases: archiveDatabases,
      databaseProperties: archiveProperties,
      databaseRows: archiveRows,
      databaseCells: archiveCells,
      databaseViews: archiveViews,
      labels: Array.from(labelsById.values()),
      dictionary,
    };
    const manifest: DocmostArchiveManifestV4 = {
      source: 'docmost',
      schemaVersion: DOCMOST_ARCHIVE_SCHEMA_VERSION,
      version: this.appVersion,
      exportedAt: new Date().toISOString(),
      scope: params.scope,
      displayName: params.displayName,
      dataFile: 'docmost-data.json',
      pages: legacyMetadata.pages,
    };

    zip.file('docmost-data.json', JSON.stringify(data, null, 2));
    zip.file('docmost-metadata.json', JSON.stringify(manifest, null, 2));
    await Promise.all(
      archiveAttachments.map(async (descriptor) => {
        const fileBuffer = attachmentBuffers.get(descriptor.id)!;
        zip.file(descriptor.archivePath, fileBuffer);
      }),
    );

    return zip;
  }

  private getPortableSpaceSettings(
    settings: unknown,
  ): DocmostPortableSpaceSettings {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return {};
    }
    const source = settings as Record<string, unknown>;
    const portable: DocmostPortableSpaceSettings = {};
    if (source.documentFields && typeof source.documentFields === 'object') {
      portable.documentFields = source.documentFields as Record<
        string,
        boolean
      >;
    }
    if (source.dictionary && typeof source.dictionary === 'object') {
      portable.dictionary = source.dictionary as { enabled?: boolean };
    }
    if (
      source.headingNumbering &&
      typeof source.headingNumbering === 'object'
    ) {
      portable.headingNumbering = source.headingNumbering as {
        enabled?: boolean;
      };
    }
    return portable;
  }

  private collectUuidStrings(value: unknown, output: Set<string>): void {
    if (typeof value === 'string') {
      if (isValidUuid(value)) output.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) this.collectUuidStrings(item, output);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        this.collectUuidStrings(item, output);
      }
    }
  }

  async zipPages(
    tree: PageExportTree,
    format: string,
    zip: JSZip,
    includeAttachments: boolean,
    locale?: string,
    spaceHeadingNumberingEnabled?: boolean,
    spaceAiRoleEnabled?: boolean,
    headingNumberingByPageId?: Record<string, boolean>,
    authorizedUser?: User,
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

        const originalJson = getProsemirrorContent(page.content);
        const materialized = await this.materializeTransclusionsWithAccess(
          originalJson,
          authorizedUser,
          locale,
          page.id,
        );
        const materializedJson = materialized.content;
        const prosemirrorJson = await this.turnPageMentionsToLinks(
          materializedJson,
          page.workspaceId,
        );

        const currentPagePath = slugIdToPath[page.slugId];

        let updatedJsonContent = replaceInternalLinks(
          prosemirrorJson,
          slugIdToPath,
          currentPagePath,
        );

        if (includeAttachments) {
          await this.zipAttachments(
            updatedJsonContent,
            page.spaceId,
            page.workspaceId,
            folder,
            materialized.attachmentPageIds,
          );
          if (format !== ExportFormat.PDF) {
            updatedJsonContent =
              updateAttachmentUrlsToLocalPaths(updatedJsonContent);
          }
        }

        const pageTitle = getPageTitle(page.title);
        const pageHeadingNumberingEnabled =
          headingNumberingByPageId &&
          Object.prototype.hasOwnProperty.call(
            headingNumberingByPageId,
            page.id,
          )
            ? headingNumberingByPageId[page.id]
            : spaceHeadingNumberingEnabled;
        const pageExportContent = await this.exportPage(
          format,
          {
            ...page,
            content: updatedJsonContent,
          },
          false,
          locale,
          pageHeadingNumberingEnabled,
          spaceAiRoleEnabled,
          authorizedUser,
          materialized.attachmentPageIds,
        );

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
          headingNumbersMaterialized:
            pageHeadingNumberingEnabled === true && format !== ExportFormat.PDF,
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

  async zipAttachments(
    prosemirrorJson: any,
    spaceId: string,
    workspaceId: string,
    zip: JSZip,
    allowedAttachmentPageIds = new Set<string>(),
  ) {
    const attachmentIds = getAttachmentIds(prosemirrorJson);

    if (attachmentIds.length > 0) {
      const attachments = await this.db
        .selectFrom('attachments')
        .selectAll()
        .where('id', 'in', attachmentIds)
        .where('workspaceId', '=', workspaceId)
        .execute();

      await Promise.all(
        attachments
          .filter((attachment) =>
            Boolean(
              attachment.pageId &&
                allowedAttachmentPageIds.has(attachment.pageId),
            ),
          )
          .map(async (attachment) => {
            try {
              const fileBuffer = await this.storageService.read(
                attachment.filePath,
              );
              const filePath = `files/${attachment.id}/${attachment.fileName}`;
              zip.file(filePath, fileBuffer);
            } catch (err) {
              this.logger.debug(
                `Attachment export error ${attachment.id}`,
                err,
              );
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
