import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreatePageDto, ContentFormat } from '../dto/create-page.dto';
import { ContentOperation, UpdatePageDto } from '../dto/update-page.dto';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import {
  InsertablePage,
  Page,
  PageSettings,
  User,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  CursorPaginationResult,
  executeWithCursorPagination,
} from '@docmost/db/pagination/cursor-pagination';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { MovePageDto } from '../dto/move-page.dto';
import { generateSlugId } from '../../../common/helpers';
import { getPageTitle } from '../../../common/helpers';
import { executeTx } from '@docmost/db/utils';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { v7 as uuid7 } from 'uuid';
import {
  createYdocFromJson,
  getAttachmentIds,
  getProsemirrorContent,
  isAttachmentNode,
  removeMarkTypeFromDoc,
} from '../../../common/helpers/prosemirror/utils';
import {
  htmlToJson,
  jsonToNode,
  jsonToText,
} from '../../../collaboration/collaboration.util';
import {
  CopyPageMapEntry,
  ICopyPageAttachment,
} from '../dto/duplicate-page.dto';
import { Node as PMNode } from '@tiptap/pm/model';
import { StorageService } from '../../../integrations/storage/storage.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { EventName } from '../../../common/events/event.contants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import { markdownToHtml } from '@docmost/editor-ext';
import { WatcherService } from '../../watcher/watcher.service';
import { RecipientResolverService } from '../../notification/services/recipient-resolver.service';
import { IPageRecipientNotificationJob } from '../../../integrations/queue/constants/queue.interface';
import { SidebarNodeType } from '../dto/sidebar-page.dto';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { DatabaseCellRepo } from '@docmost/db/repos/database/database-cell.repo';
import { DatabasePropertyRepo } from '@docmost/db/repos/database/database-property.repo';
import { DatabaseViewRepo } from '@docmost/db/repos/database/database-view.repo';

@Injectable()
export class PageService {
  private readonly logger = new Logger(PageService.name);

  constructor(
    private pageRepo: PageRepo,
    private attachmentRepo: AttachmentRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
    @InjectQueue(QueueName.AI_QUEUE) private aiQueue: Queue,
    @InjectQueue(QueueName.GENERAL_QUEUE) private generalQueue: Queue,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE) private notificationQueue: Queue,
    private eventEmitter: EventEmitter2,
    private collaborationGateway: CollaborationGateway,
    private readonly watcherService: WatcherService,
    private readonly recipientResolverService: RecipientResolverService,
    private readonly databaseRepo: DatabaseRepo,
    private readonly databaseRowRepo: DatabaseRowRepo,
    private readonly databaseCellRepo: DatabaseCellRepo,
    private readonly databasePropertyRepo: DatabasePropertyRepo,
    private readonly databaseViewRepo: DatabaseViewRepo,
  ) {}

  async findById(
    pageId: string,
    includeContent?: boolean,
    includeYdoc?: boolean,
    includeSpace?: boolean,
  ): Promise<Page> {
    return this.pageRepo.findById(pageId, {
      includeContent,
      includeYdoc,
      includeSpace,
    });
  }

  async create(
    userId: string,
    workspaceId: string,
    createPageDto: CreatePageDto,
  ): Promise<Page> {
    let parentPageId = undefined;

    // check if parent page exists
    if (createPageDto.parentPageId) {
      const parentPage = await this.pageRepo.findById(
        createPageDto.parentPageId,
      );

      if (!parentPage || parentPage.spaceId !== createPageDto.spaceId) {
        throw new NotFoundException('Parent page not found');
      }

      parentPageId = parentPage.id;
    }

    let content = undefined;
    let textContent = undefined;
    let ydoc = undefined;

    if (createPageDto?.content && createPageDto?.format) {
      const prosemirrorJson = await this.parseProsemirrorContent(
        createPageDto.content,
        createPageDto.format,
      );

      content = prosemirrorJson;
      textContent = jsonToText(prosemirrorJson);
      ydoc = createYdocFromJson(prosemirrorJson);
    }

    const page = await this.pageRepo.insertPage({
      slugId: generateSlugId(),
      title: createPageDto.title,
      position: await this.nextPagePosition(
        createPageDto.spaceId,
        parentPageId,
      ),
      icon: createPageDto.icon,
      parentPageId: parentPageId,
      spaceId: createPageDto.spaceId,
      creatorId: userId,
      workspaceId: workspaceId,
      lastUpdatedById: userId,
      content,
      textContent,
      ydoc,
      settings: createPageDto.settings,
    });


    this.generalQueue
      .add(QueueJob.ADD_PAGE_WATCHERS, {
        userIds: [userId],
        pageId: page.id,
        spaceId: createPageDto.spaceId,
        workspaceId,
      })
      .catch((err) =>
        this.logger.warn(`Failed to queue add-page-watchers: ${err.message}`),
      );

    return page;
  }

  async nextPagePosition(spaceId: string, parentPageId?: string) {
    let pagePosition: string;

    const lastPageQuery = this.db
      .selectFrom('pages')
      .select(['position'])
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .orderBy('position', (ob) => ob.collate('C').desc())
      .limit(1);

    if (parentPageId) {
      // check for children of this page
      const lastPage = await lastPageQuery
        .where('parentPageId', '=', parentPageId)
        .executeTakeFirst();

      if (!lastPage) {
        pagePosition = generateJitteredKeyBetween(null, null);
      } else {
        // if there is an existing page, we should get a position below it
        pagePosition = generateJitteredKeyBetween(lastPage.position, null);
      }
    } else {
      // for root page
      const lastPage = await lastPageQuery
        .where('parentPageId', 'is', null)
        .executeTakeFirst();

      // if no existing page, make this the first
      if (!lastPage) {
        pagePosition = generateJitteredKeyBetween(null, null); // we expect "a0"
      } else {
        // if there is an existing page, we should get a position below it
        pagePosition = generateJitteredKeyBetween(lastPage.position, null);
      }
    }

    return pagePosition;
  }

  async update(
    page: Page,
    updatePageDto: UpdatePageDto,
    user: User,
  ): Promise<Page> {
    const contributors = new Set<string>(page.contributorIds);
    contributors.add(user.id);
    const contributorIds = Array.from(contributors);

    const currentSettings = (page.settings as PageSettings | null) ?? null;
    const nextSettings = updatePageDto.toSettingsPayload(currentSettings);

    await this.pageRepo.updatePage(
      {
        title: updatePageDto.title,
        icon: updatePageDto.icon,
        lastUpdatedById: user.id,
        updatedAt: new Date(),
        contributorIds: contributorIds,
        settings: nextSettings,
      },
      page.id,
    );

    this.generalQueue
      .add(QueueJob.ADD_PAGE_WATCHERS, {
        userIds: [user.id],
        pageId: page.id,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
      })
      .catch((err) =>
        this.logger.warn(`Failed to queue add-page-watchers: ${err.message}`),
      );

    // Compute assignment deltas right after the update
    // to notify only newly assigned role participants.
    const assignmentDelta = this.recipientResolverService.resolveAssignmentDelta(
      currentSettings,
      nextSettings ?? null,
    );

    if (assignmentDelta.newAssigneeId) {
      await this.notificationQueue.add(QueueJob.PAGE_RECIPIENT_NOTIFICATION, {
        reason: 'page-assigned',
        actorId: user.id,
        pageId: page.id,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
        candidateUserIds: [assignmentDelta.newAssigneeId],
      } as IPageRecipientNotificationJob);
    }

    if (assignmentDelta.newStakeholderIds.length > 0) {
      await this.notificationQueue.add(QueueJob.PAGE_RECIPIENT_NOTIFICATION, {
        reason: 'page-stakeholder-added',
        actorId: user.id,
        pageId: page.id,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
        candidateUserIds: assignmentDelta.newStakeholderIds,
      } as IPageRecipientNotificationJob);
    }

    if (
      updatePageDto.content &&
      updatePageDto.operation &&
      updatePageDto.format
    ) {
      await this.updatePageContent(
        page.id,
        updatePageDto.content,
        updatePageDto.operation,
        updatePageDto.format,
        user,
      );
    }

    return await this.pageRepo.findById(page.id, {
      includeSpace: true,
      includeContent: true,
      includeCreator: true,
      includeLastUpdatedBy: true,
      includeContributors: true,
    });
  }

  async updatePageContent(
    pageId: string,
    content: string | object,
    operation: ContentOperation,
    format: ContentFormat,
    user: User,
  ): Promise<void> {
    const prosemirrorJson = await this.parseProsemirrorContent(content, format);

    const documentName = `page.${pageId}`;
    await this.collaborationGateway.handleYjsEvent(
      'updatePageContent',
      documentName,
      { operation, prosemirrorJson, user },
    );
  }


  /**
   * Конвертирует обычную страницу в базу данных.
   *
   * В рамках одной транзакции создаётся запись базы, после чего
   * все текущие прямые дети страницы привязываются как строки базы данных.
   */
  async convertPageToDatabase(page: Page, actorId: string): Promise<{ databaseId: string; pageId: string }> {
    const database = await executeTx(this.db, async (trx) => {
      const existingDatabase = await this.databaseRepo.findByPageIdIncludingDeleted(
        page.id,
        page.workspaceId,
      );

      const basePayload = {
        spaceId: page.spaceId,
        name: page.title?.trim() || 'Untitled database',
        icon: page.icon,
        description: null,
        workspaceId: page.workspaceId,
        creatorId: actorId,
        lastUpdatedById: actorId,
        pageId: page.id,
      };

      const restoredOrCreatedDatabase = existingDatabase
        ? await this.databaseRepo.restoreDatabase(
            existingDatabase.id,
            page.workspaceId,
            { lastUpdatedById: actorId },
            trx,
          )
        : await this.databaseRepo.insertDatabase(basePayload, trx);

      if (existingDatabase) {
        await this.databasePropertyRepo.restoreByDatabaseId(
          existingDatabase.id,
          page.workspaceId,
          trx,
        );
        await this.databaseViewRepo.restoreByDatabaseId(
          existingDatabase.id,
          page.workspaceId,
          trx,
        );
        await this.databaseCellRepo.restoreByDatabaseId(
          existingDatabase.id,
          page.workspaceId,
          trx,
        );
      }

      const descendants = await this.pageRepo.getPageAndDescendants(page.id, {
        includeContent: false,
      });

      const descendantPageIds = descendants
        .map((descendant) => descendant.id)
        .filter((descendantPageId) => descendantPageId !== page.id);

      for (const descendantPageId of descendantPageIds) {
        const existingRow = await this.databaseRowRepo.findByDatabaseAndPage(
          restoredOrCreatedDatabase.id,
          descendantPageId,
        );

        if (existingRow) {
          await this.databaseRowRepo.restoreRowLink(
            restoredOrCreatedDatabase.id,
            descendantPageId,
            page.workspaceId,
            actorId,
            trx,
          );
          continue;
        }

        await this.databaseRowRepo.insertRow(
          {
            databaseId: restoredOrCreatedDatabase.id,
            pageId: descendantPageId,
            workspaceId: page.workspaceId,
            createdById: actorId,
            updatedById: actorId,
          },
          trx,
        );
      }

      return restoredOrCreatedDatabase;
    });

    return { databaseId: database.id, pageId: page.id };
  }

  async getSidebarPages(
    spaceId: string,
    pagination: PaginationOptions,
    pageId?: string,
    includeNodeTypes?: SidebarNodeType[],
  ): Promise<
    CursorPaginationResult<
      Partial<Page> & {
        hasChildren: boolean;
        nodeType: string;
        databaseId: string | null;
      }
    >
  > {
    /**
     * Keep backward-compatible default behavior for sidebar pages endpoint.
     *
     * By default, root sidebar fetches only regular page nodes. Database nodes
     * are opt-in through includeNodeTypes to avoid changing pagination shape
     * and UX unexpectedly for clients that still render databases separately.
     */
    const requestedNodeTypes =
      includeNodeTypes && includeNodeTypes.length > 0
        ? includeNodeTypes
        : (['page'] satisfies SidebarNodeType[]);

    const includePages = requestedNodeTypes.some((type) =>
      ['page', 'databaseRow'].includes(type),
    );
    const includePageNodes = requestedNodeTypes.includes('page');
    const includeDatabaseRowNodes = requestedNodeTypes.includes('databaseRow');
    const includeDatabases = requestedNodeTypes.includes('database');

    let query = this.db
      .selectFrom('pages')
      .leftJoin('databases as linkedDatabase', (join) =>
        join
          .onRef('linkedDatabase.pageId', '=', 'pages.id')
          .on('linkedDatabase.deletedAt', 'is', null),
      )
      .select([
        'pages.id as id',
        'pages.slugId as slugId',
        'pages.title as title',
        'pages.icon as icon',
        'pages.position as position',
        'pages.parentPageId as parentPageId',
        'pages.spaceId as spaceId',
        'pages.creatorId as creatorId',
        'pages.deletedAt as deletedAt',
      ])
      .select((eb) => [
        sql<any>`pages.settings`.as('settings'),
        sql<string>`case
          when exists (
            select 1
            from database_rows
            where database_rows.page_id = pages.id
              and database_rows.archived_at is null
          ) then 'databaseRow'
          else 'page'
        end`.as('nodeType'),
        sql<string | null>`null`.as('databaseId'),
        sql<boolean>`(
          ${this.pageRepo.withHasChildren(eb)}
          or exists (
            select 1
            from databases child_database
            inner join pages child_page on child_page.id = child_database.page_id
            where child_database.deleted_at is null
              and child_page.deleted_at is null
              and child_page.parent_page_id = pages.id
          )
        )`.as('hasChildren'),
      ])
      .where('pages.deletedAt', 'is', null)
      .where('pages.spaceId', '=', spaceId)
      .where('linkedDatabase.id', 'is', null)
      .$if(!!pageId, (qb) => qb.where('pages.parentPageId', '=', pageId))
      .$if(!pageId, (qb) => qb.where('pages.parentPageId', 'is', null))
      .$if(!includePages, (qb) => qb.where(sql<boolean>`false`, '=', true))
      .$if(includePageNodes && !includeDatabaseRowNodes, (qb) =>
        qb.where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('databaseRows')
                .select('databaseRows.id')
                .whereRef('databaseRows.pageId', '=', 'pages.id')
                .where('databaseRows.archivedAt', 'is', null),
            ),
          ),
        ),
      )
      .$if(!includePageNodes && includeDatabaseRowNodes, (qb) =>
        qb.where(({ exists, selectFrom }) =>
          exists(
            selectFrom('databaseRows')
              .select('databaseRows.id')
              .whereRef('databaseRows.pageId', '=', 'pages.id')
              .where('databaseRows.archivedAt', 'is', null),
          ),
        ),
      );

    if (includeDatabases) {
      query = query.unionAll(
        this.db
          .selectFrom('databases')
          .innerJoin('pages as databasePage', 'databasePage.id', 'databases.pageId')
          .select([
            'databases.id as id',
            sql<string | null>`null`.as('slugId'),
            'databases.name as title',
            'databases.icon as icon',
            'databasePage.position as position',
            'databasePage.parentPageId as parentPageId',
            'databases.spaceId as spaceId',
            'databases.creatorId as creatorId',
            'databases.deletedAt as deletedAt',
            sql<any>`null`.as('settings'),
            sql<string>`'database'`.as('nodeType'),
            'databases.id as databaseId',
          ])
          .select([
            sql<boolean>`exists (
              select 1
              from pages as child_page
              inner join database_rows as child_row on child_row.page_id = child_page.id
              where child_page.parent_page_id = databasePage.id
                and child_page.deleted_at is null
                and child_row.archived_at is null
            )`.as('hasChildren'),
          ])
          .where('databases.deletedAt', 'is', null)
          .where('databasePage.deletedAt', 'is', null)
          .where('databases.spaceId', '=', spaceId)
          .$if(!!pageId, (qb) => qb.where('databasePage.parentPageId', '=', pageId))
          .$if(!pageId, (qb) => qb.where('databasePage.parentPageId', 'is', null)),
      );
    }

    return executeWithCursorPagination(query, {
      perPage: 250,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        {
          expression: 'position',
          direction: 'asc',
          orderModifier: (ob) => ob.collate('C').asc(),
        },
        { expression: 'id', direction: 'asc' },
      ],
      parseCursor: (cursor) => ({
        position: cursor.position,
        id: cursor.id,
      }),
    });
  }

  async movePageToSpace(rootPage: Page, spaceId: string) {
    await executeTx(this.db, async (trx) => {
      // Update root page
      const nextPosition = await this.nextPagePosition(spaceId);
      await this.pageRepo.updatePage(
        { spaceId, parentPageId: null, position: nextPosition },
        rootPage.id,
        trx,
      );
      const pageIds = await this.pageRepo
        .getPageAndDescendants(rootPage.id, { includeContent: false })
        .then((pages) => pages.map((page) => page.id));
      // The first id is the root page id
      if (pageIds.length > 1) {
        // Update sub pages
        await this.pageRepo.updatePages(
          { spaceId },
          pageIds.filter((id) => id !== rootPage.id),
          trx,
        );
      }

      if (pageIds.length > 0) {
        // update spaceId in shares
        await trx
          .updateTable('shares')
          .set({ spaceId: spaceId })
          .where('pageId', 'in', pageIds)
          .execute();

        // Update comments
        await trx
          .updateTable('comments')
          .set({ spaceId: spaceId })
          .where('pageId', 'in', pageIds)
          .execute();

        // Update attachments
        await this.attachmentRepo.updateAttachmentsByPageId(
          { spaceId },
          pageIds,
          trx,
        );

        // Update watchers and remove those without access to new space
        await this.watcherService.movePageWatchersToSpace(pageIds, spaceId, {
          trx,
        });

        await this.aiQueue.add(QueueJob.PAGE_MOVED_TO_SPACE, {
          pageId: pageIds,
          workspaceId: rootPage.workspaceId,
        });
      }
    });
  }

  async duplicatePage(
    rootPage: Page,
    targetSpaceId: string | undefined,
    authUser: User,
  ) {
    const spaceId = targetSpaceId || rootPage.spaceId;
    const isDuplicateInSameSpace =
      !targetSpaceId || targetSpaceId === rootPage.spaceId;

    let nextPosition: string;

    if (isDuplicateInSameSpace) {
      // For duplicate in same space, position right after the original page
      nextPosition = generateJitteredKeyBetween(rootPage.position, null);
    } else {
      // For copy to different space, position at the end
      nextPosition = await this.nextPagePosition(spaceId);
    }

    const pages = await this.pageRepo.getPageAndDescendants(rootPage.id, {
      includeContent: true,
    });

    const pageMap = new Map<string, CopyPageMapEntry>();
    pages.forEach((page) => {
      pageMap.set(page.id, {
        newPageId: uuid7(),
        newSlugId: generateSlugId(),
        oldSlugId: page.slugId,
      });
    });

    const attachmentMap = new Map<string, ICopyPageAttachment>();

    const insertablePages: InsertablePage[] = await Promise.all(
      pages.map(async (page) => {
        const pageContent = getProsemirrorContent(page.content);
        const pageFromMap = pageMap.get(page.id);

        const doc = jsonToNode(pageContent);
        const prosemirrorDoc = removeMarkTypeFromDoc(doc, 'comment');

        const attachmentIds = getAttachmentIds(prosemirrorDoc.toJSON());

        if (attachmentIds.length > 0) {
          attachmentIds.forEach((attachmentId: string) => {
            const newPageId = pageFromMap.newPageId;
            const newAttachmentId = uuid7();
            attachmentMap.set(attachmentId, {
              newPageId: newPageId,
              oldPageId: page.id,
              oldAttachmentId: attachmentId,
              newAttachmentId: newAttachmentId,
            });

            prosemirrorDoc.descendants((node: PMNode) => {
              if (isAttachmentNode(node.type.name)) {
                if (node.attrs.attachmentId === attachmentId) {
                  //@ts-ignore
                  node.attrs.attachmentId = newAttachmentId;

                  if (node.attrs.src) {
                    //@ts-ignore
                    node.attrs.src = node.attrs.src.replace(
                      attachmentId,
                      newAttachmentId,
                    );
                  }
                  if (node.attrs.src) {
                    //@ts-ignore
                    node.attrs.src = node.attrs.src.replace(
                      attachmentId,
                      newAttachmentId,
                    );
                  }
                }
              }
            });
          });
        }

        // Update internal page links in mention nodes
        prosemirrorDoc.descendants((node: PMNode) => {
          if (
            node.type.name === 'mention' &&
            node.attrs.entityType === 'page'
          ) {
            const referencedPageId = node.attrs.entityId;

            // Check if the referenced page is within the pages being copied
            if (referencedPageId && pageMap.has(referencedPageId)) {
              const mappedPage = pageMap.get(referencedPageId);
              //@ts-ignore
              node.attrs.entityId = mappedPage.newPageId;
              //@ts-ignore
              node.attrs.slugId = mappedPage.newSlugId;
            }
          }
        });

        const prosemirrorJson = prosemirrorDoc.toJSON();

        // Add "Copy of " prefix to the root page title only for duplicates in same space
        let title = page.title;
        if (isDuplicateInSameSpace && page.id === rootPage.id) {
          const originalTitle = getPageTitle(page.title);
          title = `Copy of ${originalTitle}`;
        }

        return {
          id: pageFromMap.newPageId,
          slugId: pageFromMap.newSlugId,
          title: title,
          icon: page.icon,
          content: prosemirrorJson,
          textContent: jsonToText(prosemirrorJson),
          ydoc: createYdocFromJson(prosemirrorJson),
          position: page.id === rootPage.id ? nextPosition : page.position,
          spaceId: spaceId,
          workspaceId: page.workspaceId,
          creatorId: authUser.id,
          lastUpdatedById: authUser.id,
          parentPageId:
            page.id === rootPage.id
              ? isDuplicateInSameSpace
                ? rootPage.parentPageId
                : null
              : page.parentPageId
                ? pageMap.get(page.parentPageId)?.newPageId
                : null,
        };
      }),
    );

    await this.db.insertInto('pages').values(insertablePages).execute();

    const insertedPageIds = insertablePages.map((page) => page.id);
    this.eventEmitter.emit(EventName.PAGE_CREATED, {
      pageIds: insertedPageIds,
      workspaceId: authUser.workspaceId,
    });

    //TODO: best to handle this in a queue
    const attachmentsIds = Array.from(attachmentMap.keys());
    if (attachmentsIds.length > 0) {
      const attachments = await this.db
        .selectFrom('attachments')
        .selectAll()
        .where('id', 'in', attachmentsIds)
        .where('workspaceId', '=', rootPage.workspaceId)
        .execute();

      for (const attachment of attachments) {
        try {
          const pageAttachment = attachmentMap.get(attachment.id);

          // make sure the copied attachment belongs to the page it was copied from
          if (attachment.pageId !== pageAttachment.oldPageId) {
            continue;
          }

          const newAttachmentId = pageAttachment.newAttachmentId;

          const newPageId = pageAttachment.newPageId;

          const newPathFile = attachment.filePath.replace(
            attachment.id,
            newAttachmentId,
          );

          try {
            await this.storageService.copy(attachment.filePath, newPathFile);

            await this.db
              .insertInto('attachments')
              .values({
                id: newAttachmentId,
                type: attachment.type,
                filePath: newPathFile,
                fileName: attachment.fileName,
                fileSize: attachment.fileSize,
                mimeType: attachment.mimeType,
                fileExt: attachment.fileExt,
                creatorId: attachment.creatorId,
                workspaceId: attachment.workspaceId,
                pageId: newPageId,
                spaceId: spaceId,
              })
              .execute();
          } catch (err) {
            this.logger.error(
              `Duplicate page: failed to copy attachment ${attachment.id}`,
              err,
            );
            // Continue with other attachments even if one fails
          }
        } catch (err) {
          this.logger.error(err);
        }
      }
    }

    const newPageId = pageMap.get(rootPage.id).newPageId;
    const duplicatedPage = await this.pageRepo.findById(newPageId, {
      includeSpace: true,
    });

    const hasChildren = pages.length > 1;

    return {
      ...duplicatedPage,
      hasChildren,
    };
  }

  async movePage(dto: MovePageDto, movedPage: Page) {
    // validate position value by attempting to generate a key
    try {
      generateJitteredKeyBetween(dto.position, null);
    } catch (err) {
      throw new BadRequestException('Invalid move position');
    }

    let parentPageId = null;
    if (movedPage.parentPageId === dto.parentPageId) {
      parentPageId = undefined;
    } else {
      // changing the page's parent
      if (dto.parentPageId) {
        const parentPage = await this.pageRepo.findById(dto.parentPageId);
        if (!parentPage || parentPage.spaceId !== movedPage.spaceId) {
          throw new NotFoundException('Parent page not found');
        }
        parentPageId = parentPage.id;
      }
    }

    await this.pageRepo.updatePage(
      {
        position: dto.position,
        parentPageId: parentPageId,
      },
      dto.pageId,
    );
  }

  async getPageBreadCrumbs(childPageId: string) {
    const ancestors = await this.db
      .withRecursive('page_ancestors', (db) =>
        db
          .selectFrom('pages')
          .select([
            'id',
            'slugId',
            'title',
            'icon',
            'position',
            'parentPageId',
            'spaceId',
            'deletedAt',
          ])
          .select((eb) => this.pageRepo.withHasChildren(eb))
          .where('id', '=', childPageId)
          .where('deletedAt', 'is', null)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .select([
                'p.id',
                'p.slugId',
                'p.title',
                'p.icon',
                'p.position',
                'p.parentPageId',
                'p.spaceId',
                'p.deletedAt',
              ])
              .select(
                exp
                  .selectFrom('pages as child')
                  .select((eb) =>
                    eb
                      .case()
                      .when(eb.fn.countAll(), '>', 0)
                      .then(true)
                      .else(false)
                      .end()
                      .as('count'),
                  )
                  .whereRef('child.parentPageId', '=', 'id')
                  .where('child.deletedAt', 'is', null)
                  .limit(1)
                  .as('hasChildren'),
              )
              //.select((eb) => this.withHasChildren(eb))
              .innerJoin('page_ancestors as pa', 'pa.parentPageId', 'p.id')
              .where('p.deletedAt', 'is', null),
          ),
      )
      .selectFrom('page_ancestors')
      .selectAll()
      .execute();

    return ancestors.reverse();
  }

  async getRecentSpacePages(
    spaceId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Page>> {
    return this.pageRepo.getRecentPagesInSpace(spaceId, pagination);
  }

  async getRecentPages(
    userId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Page>> {
    return this.pageRepo.getRecentPages(userId, pagination);
  }

  async getDeletedSpacePages(
    spaceId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Page>> {
    return this.pageRepo.getDeletedPagesInSpace(spaceId, pagination);
  }

  async forceDelete(pageId: string, workspaceId: string): Promise<void> {
    // Get all descendant IDs (including the page itself) using recursive CTE
    const descendants = await this.db
      .withRecursive('page_descendants', (db) =>
        db
          .selectFrom('pages')
          .select(['id'])
          .where('id', '=', pageId)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .select(['p.id'])
              .innerJoin('page_descendants as pd', 'pd.id', 'p.parentPageId'),
          ),
      )
      .selectFrom('page_descendants')
      .selectAll()
      .execute();

    const pageIds = descendants.map((d) => d.id);

    // Queue attachment deletion for all pages with unique job IDs to prevent duplicates
    for (const id of pageIds) {
      await this.attachmentQueue.add(
        QueueJob.DELETE_PAGE_ATTACHMENTS,
        {
          pageId: id,
        },
        {
          jobId: `delete-page-attachments-${id}`,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );
    }

    if (pageIds.length > 0) {
      await this.db.deleteFrom('pages').where('id', 'in', pageIds).execute();
      this.eventEmitter.emit(EventName.PAGE_DELETED, {
        pageIds: pageIds,
        workspaceId,
      });
    }
  }

  async removePage(
    pageId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.pageRepo.removePage(pageId, userId, workspaceId);
  }

  private async parseProsemirrorContent(
    content: string | object,
    format: ContentFormat,
  ): Promise<any> {
    let prosemirrorJson: any;

    switch (format) {
      case 'markdown': {
        const html = await markdownToHtml(content as string);
        prosemirrorJson = htmlToJson(html as string);
        break;
      }
      case 'html': {
        prosemirrorJson = htmlToJson(content as string);
        break;
      }
      case 'json':
      default: {
        prosemirrorJson = content;
        break;
      }
    }

    try {
      jsonToNode(prosemirrorJson);
    } catch (err) {
      throw new BadRequestException('Invalid content format');
    }

    return prosemirrorJson;
  }
}
