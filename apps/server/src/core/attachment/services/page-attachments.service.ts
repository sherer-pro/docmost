import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '../../../database/types/kysely.types';
import { User } from '../../../database/types/entity.types';
import { PageRepo } from '../../../database/repos/page/page.repo';
import { PaginationOptions } from '../../../database/pagination/pagination-options';
import { executeWithCursorPagination } from '../../../database/pagination/cursor-pagination';
import { PageAccessService } from '../../page-access/page-access.service';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { QueueOutboxService } from '../../../integrations/queue/outbox/queue-outbox.service';
import { pageAttachmentUsages } from './page-attachment-usages';

@Injectable()
export class PageAttachmentsService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pages: PageRepo,
    private readonly access: PageAccessService,
    private readonly abilities: SpaceAbilityFactory,
    private readonly outbox: QueueOutboxService,
  ) {}

  private async page(pageId: string, user: User) {
    const page = await this.pages.findById(pageId, { includeContent: true });
    if (!page || page.deletedAt || page.workspaceId !== user.workspaceId)
      throw new NotFoundException('Page not found');
    await this.access.assertCanReadPage(page, user);
    return page;
  }

  async list(pageId: string, options: PaginationOptions, user: User) {
    const page = await this.page(pageId, user);
    const usages = pageAttachmentUsages(page.content);
    const ids = [...usages.keys()];
    const sourcePages = ids.length
      ? await this.db
          .selectFrom('pages')
          .select(['pages.id', 'pages.spaceId', 'pages.workspaceId'])
          .where('pages.workspaceId', '=', user.workspaceId)
          .where('pages.deletedAt', 'is', null)
          .where(
            'pages.id',
            'in',
            this.db
              .selectFrom('attachments')
              .select('pageId')
              .where('workspaceId', '=', user.workspaceId)
              .where(sql<boolean>`${sql.ref('id')} = any(${ids}::uuid[])`),
          )
          .execute()
      : [];
    const effective = await this.access.getEffectiveAccessForPages(
      [page, ...sourcePages],
      user,
    );
    const readable = [...effective]
      .filter(([, access]) => access.capabilities.canRead)
      .map(([id]) => id);
    let query = this.db
      .selectFrom('attachments')
      .select([
        'id',
        'fileName',
        'fileSize',
        'fileExt',
        'mimeType',
        'pageId',
        'createdAt',
      ])
      .where('workspaceId', '=', user.workspaceId)
      .where('deletedAt', 'is', null)
      .where('type', '=', 'file')
      .where(sql<boolean>`${sql.ref('pageId')} = any(${readable}::uuid[])`)
      .where((eb) =>
        eb.or([
          eb('pageId', '=', page.id),
          ...(ids.length
            ? [sql<boolean>`${sql.ref('id')} = any(${ids}::uuid[])`]
            : []),
        ]),
      );
    if (options.query?.trim())
      query = query.where(
        'fileName',
        'ilike',
        `%${options.query.trim().replace(/[\\%_]/g, '\\$&')}%`,
      );
    const result = await executeWithCursorPagination(query, {
      perPage: options.limit ?? 50,
      cursor: options.cursor,
      fields: [
        { expression: 'fileName', direction: 'asc' },
        { expression: 'id', direction: 'asc' },
      ] as const,
      parseCursor: (cursor) => ({ fileName: cursor.fileName, id: cursor.id }),
    });
    const ability = await this.abilities.createForUser(user, page.spaceId);
    return {
      ...result,
      canDelete:
        ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings) &&
        effective.get(page.id)?.capabilities.canWrite === true,
      items: result.items.map((file) => ({
        ...file,
        fileSize: Number(file.fileSize),
        usages: usages.get(file.id) ?? [],
        owned: file.pageId === page.id,
      })),
    };
  }

  async remove(pageId: string, attachmentId: string, user: User) {
    const page = await this.page(pageId, user);
    const ability = await this.abilities.createForUser(user, page.spaceId);
    if (!ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings))
      throw new ForbiddenException();
    await this.access.assertCanWritePage(page, user);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('pages')
        .select('id')
        .where('id', '=', page.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const file = await trx
        .selectFrom('attachments')
        .select('id')
        .where('id', '=', attachmentId)
        .where('workspaceId', '=', user.workspaceId)
        .where('pageId', '=', page.id)
        .where('type', '=', 'file')
        .forUpdate()
        .executeTakeFirst();
      if (!file) throw new NotFoundException('Attachment not found');
      const pattern = `%${file.id}%`;
      const current = await trx
        .selectFrom('pages')
        .select('id')
        .where('workspaceId', '=', user.workspaceId)
        .where(sql<boolean>`content::text ilike ${pattern}`)
        .executeTakeFirst();
      const history = await trx
        .selectFrom('pageHistory')
        .select('id')
        .where('workspaceId', '=', user.workspaceId)
        .where(
          sql<boolean>`(content::text ilike ${pattern} or change_data::text ilike ${pattern})`,
        )
        .executeTakeFirst();
      const templates = await trx
        .selectFrom('pageTemplateRevisions')
        .select('id')
        .where('workspaceId', '=', user.workspaceId)
        .where(sql<boolean>`content::text ilike ${pattern}`)
        .executeTakeFirst();
      const cells = await trx
        .selectFrom('databaseCells')
        .select('id')
        .where('workspaceId', '=', user.workspaceId)
        .where((eb) =>
          eb.or([
            eb('attachmentId', '=', attachmentId),
            sql<boolean>`value::text ilike ${pattern}`,
          ]),
        )
        .executeTakeFirst();
      if (current || history || templates || cells)
        throw new ConflictException({
          code: 'attachment_in_use',
          message: 'Attachment is referenced by content or history',
        });
      if (
        !(await this.outbox.enqueueAttachmentCleanup(
          attachmentId,
          user.workspaceId,
          trx,
        ))
      )
        throw new ConflictException('Attachment cleanup is already pending');
    });
    this.outbox.kick();
    return { queued: true };
  }
}
