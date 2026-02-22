import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ShareService } from './share.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { join } from 'path';
import * as fs from 'node:fs';
import { validate as isValidUUID } from 'uuid';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { Workspace } from '@docmost/db/types/entity.types';
import { htmlEscape } from '../../common/helpers/html-escaper';

@Controller('share')
export class ShareSeoController {
  constructor(
    private readonly shareService: ShareService,
    private workspaceRepo: WorkspaceRepo,
    private environmentService: EnvironmentService,
  ) {}

  /**
   * Подготавливает безопасный заголовок для вставки в HTML.
   *
   * Важно: сначала ограничиваем длину исходной строки, и только затем
   * экранируем специальные символы. Так мы избегаем обрезания HTML-сущностей
   * посередине (например, `&quot;`), что делает итоговый вывод предсказуемым.
   *
   * @param title Исходный заголовок страницы из БД.
   * @returns Экранированная строка, безопасная для `<title>` и `content` атрибутов мета-тегов.
   */
  private buildSafeMetaTitle(title?: string | null): string {
    const rawTitle = title ?? 'untitled';
    const trimmedTitle =
      rawTitle.length > 80 ? `${rawTitle.slice(0, 77)}…` : rawTitle;

    return htmlEscape(trimmedTitle);
  }

  /**
   * Формирует OpenGraph/Twitter/Robots meta-теги для публичной страницы.
   *
   * @param safeTitle Уже экранированный заголовок страницы.
   * @param searchIndexing Флаг разрешения индексации поисковиками.
   * @returns Готовый HTML-фрагмент meta-тегов.
   */
  private buildMetaTags(safeTitle: string, searchIndexing: boolean): string {
    return [
      `<meta property="og:title" content="${safeTitle}" />`,
      `<meta property="twitter:title" content="${safeTitle}" />`,
      !searchIndexing ? '<meta name="robots" content="noindex" />' : '',
    ]
      .filter(Boolean)
      .join('\n    ');
  }

  /*
   * add meta tags to publicly shared pages
   */
  @Get([':shareId/p/:pageSlug', 'p/:pageSlug'])
  async getShare(
    @Res({ passthrough: false }) res: FastifyReply,
    @Req() req: FastifyRequest,
    @Param('shareId') shareId: string,
    @Param('pageSlug') pageSlug: string,
  ) {
    // Nestjs does not to apply middlewares to paths excluded from the global /api prefix
    // https://github.com/nestjs/nest/issues/9124
    // https://github.com/nestjs/nest/issues/11572
    // https://github.com/nestjs/nest/issues/13401
    // we have to duplicate the DomainMiddleware code here as a workaround

    let workspace: Workspace = null;
    if (this.environmentService.isSelfHosted()) {
      workspace = await this.workspaceRepo.findFirst();
    } else {
      const header = req.raw.headers.host;
      const subdomain = header.split('.')[0];
      workspace = await this.workspaceRepo.findByHostname(subdomain);
    }

    const clientDistPath = join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'client/dist',
    );

    if (fs.existsSync(clientDistPath)) {
      const indexFilePath = join(clientDistPath, 'index.html');

      if (!workspace) {
        return this.sendIndex(indexFilePath, res);
      }

      const pageId = this.extractPageSlugId(pageSlug);

      const share = await this.shareService.getShareForPage(
        pageId,
        workspace.id,
      );

      if (!share) {
        return this.sendIndex(indexFilePath, res);
      }

      const metaTitle = this.buildSafeMetaTitle(share?.sharedPage.title);

      const metaTagVar = '<!--meta-tags-->';

      const metaTags = this.buildMetaTags(metaTitle, share.searchIndexing);

      const html = fs.readFileSync(indexFilePath, 'utf8');
      const transformedHtml = html
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${metaTitle}</title>`)
        .replace(metaTagVar, metaTags);

      res.type('text/html').send(transformedHtml);
    }
  }

  sendIndex(indexFilePath: string, res: FastifyReply) {
    const stream = fs.createReadStream(indexFilePath);
    res.type('text/html').send(stream);
  }

  extractPageSlugId(slug: string): string {
    if (!slug) {
      return undefined;
    }
    if (isValidUUID(slug)) {
      return slug;
    }
    const parts = slug.split('-');
    return parts.length > 1 ? parts[parts.length - 1] : slug;
  }
}
