import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateShareDto, ShareInfoDto, UpdateShareDto } from './dto/share.dto';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { nanoIdGen } from '../../common/helpers';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { jsonToNode } from '../../collaboration/collaboration.util';
import {
  getProsemirrorContent,
  isAttachmentNode,
  removeMarkTypeFromDoc,
} from '../../common/helpers/prosemirror/utils';
import { Node } from '@tiptap/pm/model';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { updateAttachmentAttr } from './share.util';
import { Page, SpaceSettings } from '@docmost/db/types/entity.types';
import { sql } from 'kysely';
import { MAX_PAGE_TREE_DEPTH } from '../../common/config/page-tree.constants';
import { validate as isValidUUID } from 'uuid';
import { TransclusionService } from '../page/transclusion/transclusion.service';
import { PageEmbedService } from '../page/transclusion/page-embed.service';
import { resolveHeadingNumberingEnabled } from '../page/utils/heading-numbering-settings.utils';
import { executeTx } from '@docmost/db/utils';
import { PublicSharingPolicyService } from './public-sharing-policy.service';

@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);

  constructor(
    private readonly shareRepo: ShareRepo,
    private readonly pageRepo: PageRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly transclusionService: TransclusionService,
    private readonly pageEmbedService: PageEmbedService,
    private readonly publicSharingPolicy: PublicSharingPolicyService,
  ) {}

  async getShareTree(shareId: string, workspaceId: string) {
    const share = await this.shareRepo.findById(shareId);
    if (!share || share.workspaceId !== workspaceId) {
      throw new NotFoundException('Share not found');
    }

    const rootPage = await this.pageRepo.findById(share.pageId);
    if (
      !rootPage ||
      rootPage.deletedAt ||
      rootPage.workspaceId !== workspaceId ||
      rootPage.spaceId !== share.spaceId
    ) {
      throw new NotFoundException('Share not found');
    }

    if (share.includeSubPages) {
      const pageList = await this.pageRepo.getPageAndDescendants(share.pageId, {
        includeContent: false,
      });

      return { share, pageTree: pageList };
    } else {
      return { share, pageTree: [] };
    }
  }

  async createShare(opts: {
    authUserId: string;
    workspaceId: string;
    page: Page;
    createShareDto: CreateShareDto;
  }) {
    const { authUserId, workspaceId, page, createShareDto } = opts;

    return executeTx(this.db, async (trx) => {
      const workspace = await trx
        .selectFrom('workspaces')
        .select(['id', 'settings'])
        .where('id', '=', workspaceId)
        .forUpdate()
        .executeTakeFirst();
      const space = await trx
        .selectFrom('spaces')
        .select(['id', 'workspaceId', 'settings'])
        .where('id', '=', page.spaceId)
        .where('workspaceId', '=', workspaceId)
        .forUpdate()
        .executeTakeFirst();

      if (
        !workspace ||
        !space ||
        !this.isSharingAllowedBySettings(workspace.settings, space.settings)
      ) {
        throw new ForbiddenException('Public sharing is disabled');
      }

      await this.lockSharePage(
        trx,
        page.id,
        workspaceId,
        page.spaceId,
      );

      const existingShare = await this.shareRepo.findByPageId(page.id, {
        trx,
      });
      if (existingShare) {
        return existingShare;
      }

      return this.shareRepo.insertShare(
        {
          key: nanoIdGen().toLowerCase(),
          pageId: page.id,
          allowPublicLiveEmbed:
            createShareDto.allowPublicLiveEmbed ?? false,
          includeSubPages: createShareDto.includeSubPages ?? false,
          searchIndexing: createShareDto.searchIndexing ?? false,
          creatorId: authUserId,
          spaceId: page.spaceId,
          workspaceId,
        },
        trx,
      );
    });
  }

  async updateShare(shareId: string, updateShareDto: UpdateShareDto) {
    try {
      return await this.shareRepo.updateShare(
        {
          includeSubPages: updateShareDto.includeSubPages,
          searchIndexing: updateShareDto.searchIndexing,
          allowPublicLiveEmbed: updateShareDto.allowPublicLiveEmbed,
        },
        shareId,
      );
    } catch (err) {
      this.logger.error(err);
      throw new BadRequestException('Failed to update share');
    }
  }

  async getSharedPage(dto: ShareInfoDto, workspaceId: string) {
    let share = null;
    let page = null;

    if (dto.pageId) {
      share = await this.getShareForPage(dto.pageId, workspaceId, dto.shareId);
      if (!share) {
        throw new NotFoundException('Shared page not found');
      }

      page = await this.pageRepo.findBySlugId(dto.pageId, {
        includeContent: true,
        includeCreator: true,
        includeSpace: true,
      });
    } else if (dto.shareId) {
      const shareById = await this.shareRepo.findById(dto.shareId);
      if (!shareById || shareById.workspaceId !== workspaceId) {
        throw new NotFoundException('Shared page not found');
      }

      const rootPage = await this.pageRepo.findById(shareById.pageId);
      if (
        !rootPage ||
        rootPage.deletedAt ||
        rootPage.workspaceId !== workspaceId ||
        rootPage.spaceId !== shareById.spaceId
      ) {
        throw new NotFoundException('Shared page not found');
      }

      share = await this.getShareForPage(
        rootPage.slugId,
        workspaceId,
        dto.shareId,
      );
      if (!share) {
        throw new NotFoundException('Shared page not found');
      }

      page = await this.pageRepo.findById(rootPage.id, {
        includeContent: true,
        includeCreator: true,
        includeSpace: true,
      });
    } else {
      throw new NotFoundException('Shared page not found');
    }

    if (!page || page.deletedAt) {
      throw new NotFoundException('Shared page not found');
    }

    const pageWithSpace = page as Page & {
      space?: { settings?: unknown };
    };
    const headingNumberingEnabled = resolveHeadingNumberingEnabled(
      pageWithSpace.space?.settings,
    );
    const spaceSettings = pageWithSpace.space?.settings as
      | SpaceSettings
      | undefined;
    const readingTimeEnabled =
      spaceSettings?.documentFields?.readingTime === true;
    const { space: _space, ...publicPage } = pageWithSpace;
    publicPage.content = await this.updatePublicAttachments(publicPage as Page);

    return {
      page: publicPage,
      share,
      headingNumberingEnabled,
      readingTimeEnabled,
    };
  }

  async getShareForPage(
    pageId: string,
    workspaceId: string,
    expectedShareId?: string,
  ) {
    // here we try to check if a page was shared directly or if it inherits the share from its closest shared ancestor
    const share = await this.db
      .withRecursive('page_hierarchy', (cte) =>
        cte
          .selectFrom('pages')
          .leftJoin('shares', 'shares.pageId', 'pages.id')
          .select([
            'pages.id',
            'pages.slugId',
            'pages.title',
            'pages.icon',
            'pages.parentPageId',
            'pages.spaceId as pageSpaceId',
            'pages.workspaceId as pageWorkspaceId',
            sql`0`.as('level'),
            'shares.id as shareId',
            'shares.key as shareKey',
            'shares.includeSubPages',
            'shares.allowPublicLiveEmbed',
            'shares.searchIndexing',
            'shares.creatorId',
            'shares.spaceId',
            'shares.workspaceId',
            'shares.createdAt',
          ])
          .where('pages.slugId', '=', pageId)
          .where('pages.deletedAt', 'is', null)
          .unionAll(
            (union) =>
              union
                .selectFrom('pages as p')
                .innerJoin('page_hierarchy as ph', 'ph.parentPageId', 'p.id')
                .leftJoin('shares as s', 's.pageId', 'p.id')
                .select([
                  'p.id',
                  'p.slugId',
                  'p.title',
                  'p.icon',
                  'p.parentPageId',
                  'p.spaceId as pageSpaceId',
                  'p.workspaceId as pageWorkspaceId',
                  sql`ph.level + 1`.as('level'),
                  's.id as shareId',
                  's.key as shareKey',
                  's.includeSubPages',
                  's.allowPublicLiveEmbed',
                  's.searchIndexing',
                  's.creatorId',
                  's.spaceId',
                  's.workspaceId',
                  's.createdAt',
                ])
                .where('p.deletedAt', 'is', null)
                .where(sql`ph.share_id`, 'is', null) // stop if share found
                .where(sql`ph.level`, '<', sql`25`), // prevent loop
          ),
      )
      .selectFrom('page_hierarchy')
      .selectAll()
      .where('shareId', 'is not', null)
      .limit(1)
      .executeTakeFirst();

    if (
      !share ||
      share.workspaceId !== workspaceId ||
      share.pageWorkspaceId !== workspaceId ||
      share.pageSpaceId !== share.spaceId
    ) {
      return undefined;
    }

    if ((share.level as number) > 0 && !share.includeSubPages) {
      return undefined;
    }

    if (expectedShareId) {
      const shareIdMatches = isValidUUID(expectedShareId)
        ? share.shareId === expectedShareId
        : String(share.shareKey).toLowerCase() === expectedShareId.toLowerCase();

      if (!shareIdMatches) {
        return undefined;
      }
    }

    return {
      id: share.shareId,
      key: share.shareKey,
      includeSubPages: share.includeSubPages,
      allowPublicLiveEmbed: share.allowPublicLiveEmbed,
      searchIndexing: share.searchIndexing,
      pageId: share.id,
      creatorId: share.creatorId,
      spaceId: share.spaceId,
      workspaceId: share.workspaceId,
      createdAt: share.createdAt,
      level: share.level,
      sharedPage: {
        id: share.id,
        slugId: share.slugId,
        title: share.title,
        icon: share.icon,
      },
    };
  }

  async getShareAncestorPage(
    ancestorPageSlugId: string,
    childPageSlugId: string,
  ): Promise<any> {
    let ancestor = null;
    try {
      ancestor = await this.db
        .withRecursive('page_ancestors', (db) =>
          db
            .selectFrom('pages')
            .select([
              'id',
              'slugId',
              'title',
              'parentPageId',
              'spaceId',
              (eb) =>
                eb
                  .case()
                  .when(eb.ref('slugId'), '=', ancestorPageSlugId)
                  .then(true)
                  .else(false)
                  .end()
                  .as('found'),
              sql<number>`0`.as('level'),
            ])
            .where('slugId', '=', childPageSlugId)
            .unionAll((exp) =>
              exp
                .selectFrom('pages as p')
                .select([
                  'p.id',
                  'p.slugId',
                  'p.title',
                  'p.parentPageId',
                  'p.spaceId',
                  (eb) =>
                    eb
                      .case()
                      .when(eb.ref('p.slugId'), '=', ancestorPageSlugId)
                      .then(true)
                      .else(false)
                      .end()
                      .as('found'),
                  sql<number>`pa.level + 1`.as('level'),
                ])
                .innerJoin('page_ancestors as pa', 'pa.parentPageId', 'p.id')
                // Continue recursing only when the target ancestor hasn't been found on that branch.
                .where('pa.found', '=', false)
                .where(sql`pa.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH)),
            ),
        )
        .selectFrom('page_ancestors')
        .selectAll()
        .where('found', '=', true)
        .limit(1)
        .executeTakeFirst();
    } catch (err) {
      // empty
    }

    return ancestor;
  }

  async lookupTransclusionForShare(
    shareId: string,
    references: Array<{
      kind?: 'block' | 'page';
      sourcePageId: string;
      transclusionId?: string;
    }>,
    workspaceId: string,
  ) {
    const share = await this.shareRepo.findById(shareId);
    if (!share || share.workspaceId !== workspaceId) {
      throw new NotFoundException('Share not found');
    }

    const sharingAllowed = await this.isSharingAllowed(workspaceId, share.spaceId);
    if (!sharingAllowed) {
      throw new NotFoundException('Share not found');
    }

    const candidatePageIds = [
      ...new Set(references.map((reference) => reference.sourcePageId)),
    ];
    const accessiblePageIds = new Set<string>();

    for (const pageId of candidatePageIds) {
      const page = await this.pageRepo.findById(pageId);
      if (!page || page.deletedAt || page.workspaceId !== workspaceId) {
        continue;
      }

      const inheritedShare = await this.getShareForPage(
        page.slugId,
        workspaceId,
        shareId,
      );
      if (inheritedShare) {
        accessiblePageIds.add(page.id);
      }
    }

    const blockReferences = references
      .map((reference, index) => ({ reference, index }))
      .filter(({ reference }) => (reference.kind ?? 'block') === 'block');
    const pageReferences = references
      .map((reference, index) => ({ reference, index }))
      .filter(({ reference }) => reference.kind === 'page');
    const [blocks, pages] = await Promise.all([
      this.transclusionService.lookupWithAccessSet(
        blockReferences.map(({ reference }) => ({
          sourcePageId: reference.sourcePageId,
          transclusionId: reference.transclusionId!,
        })),
        accessiblePageIds,
        workspaceId,
      ),
      share.allowPublicLiveEmbed
        ? this.pageEmbedService.lookupWithAccessSet(
            pageReferences.map(({ reference }) => reference.sourcePageId),
            accessiblePageIds,
            workspaceId,
            undefined,
            true,
            share.spaceId,
          )
        : Promise.resolve({
            items: pageReferences.map(({ reference }) => ({
              kind: 'page' as const,
              sourcePageId: reference.sourcePageId,
              status: 'disabled' as const,
            })),
          }),
    ]);
    for (const item of [...blocks.items, ...pages.items]) {
      if (item && 'content' in item) {
        item.content = await this.updatePublicContentAttachments(item.content);
      }
    }
    const items = new Array(references.length);
    blockReferences.forEach(({ index }, resultIndex) => {
      items[index] = blocks.items[resultIndex];
    });
    pageReferences.forEach(({ index }, resultIndex) => {
      items[index] = pages.items[resultIndex];
    });
    return { items, maxDepth: this.pageEmbedService.getMaxDepth() };
  }

  async isSharingAllowed(
    workspaceId: string,
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    return this.publicSharingPolicy.isAllowed(workspaceId, spaceId, trx);
  }

  private isSharingAllowedBySettings(
    workspaceSettings: unknown,
    spaceSettings: unknown,
  ): boolean {
    return this.publicSharingPolicy.isAllowedBySettings(
      workspaceSettings,
      spaceSettings,
    );
  }

  private async lockSharePage(
    trx: KyselyTransaction,
    pageId: string,
    workspaceId: string,
    spaceId: string,
  ) {
    const page = await trx
      .selectFrom('pages')
      .select('id')
      .where('id', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!page) {
      throw new NotFoundException('Page not found');
    }
  }

  async updatePublicAttachments(page: Page): Promise<any> {
    return this.updatePublicContentAttachments(page.content);
  }

  private async updatePublicContentAttachments(content: unknown): Promise<any> {
    const prosemirrorJson = getProsemirrorContent(content);
    const doc = jsonToNode(prosemirrorJson);

    doc?.descendants((node: Node) => {
      if (!isAttachmentNode(node.type.name)) return;

      updateAttachmentAttr(node, 'src');
      updateAttachmentAttr(node, 'url');
    });

    const removeCommentMarks = removeMarkTypeFromDoc(doc, 'comment');
    return removeCommentMarks.toJSON();
  }
}
