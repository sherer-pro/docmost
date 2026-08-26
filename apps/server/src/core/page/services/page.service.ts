import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
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
import { MAX_PAGE_TREE_DEPTH } from '../../../common/config/page-tree.constants';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
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
import { CopyPageMapEntry } from '../dto/duplicate-page.dto';
import { Node as PMNode } from '@tiptap/pm/model';
import { StorageService } from '../../../integrations/storage/storage.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { EventName } from '../../../common/events/event.contants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  COLLABORATION_DOCUMENT_PORT,
  CollaborationDocumentPort,
} from '../../../collaboration/collaboration-document.port';
import {
  markdownToHtml,
  validateTemplateInstanceMutation,
} from '@docmost/editor-ext/server';
import { WatcherService } from '../../watcher/watcher.service';
import { RecipientResolverService } from '../../notification/services/recipient-resolver.service';
import {
  IDuplicatePageAttachmentMapping,
  IPageRecipientNotificationJob,
} from '../../../integrations/queue/constants/queue.interface';
import { SidebarNodeType } from '../dto/sidebar-page.dto';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { DatabaseCellRepo } from '@docmost/db/repos/database/database-cell.repo';
import { DatabasePropertyRepo } from '@docmost/db/repos/database/database-property.repo';
import { DatabaseViewRepo } from '@docmost/db/repos/database/database-view.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import {
  getPageAiRole,
  getPageAssigneeId,
  getPageStakeholderIds,
  normalizePageSettings,
  stripLegacyHeadingNumberingSetting,
} from '../utils/page-settings.utils';
import { PageHistoryRecorderService } from './page-history-recorder.service';
import { PageAccessService } from '../../page-access/page-access.service';
import { PageAccessMutationService } from './page-access-mutation.service';
import { TransclusionService } from '../transclusion/transclusion.service';
import {
  remapDatabasePageReference,
  remapDatabaseViewConfig,
} from '../../database/utils/database-copy.utils';
import { QueueOutboxService } from '../../../integrations/queue/outbox/queue-outbox.service';
import type { TemplateKind } from '@docmost/api-contract';
import { PageTemplatePolicyService } from '../transclusion/page-template-policy.service';

interface IHistoryUserRef {
  id: string;
  name: string;
}

type CustomFieldHistoryChange = {
  field: 'status' | 'assigneeId' | 'stakeholderIds' | 'aiRole';
  oldValue: unknown;
  newValue: unknown;
};

type CopiedPageByOriginalId = Map<string, InsertablePage>;

interface DuplicatePageOptions {
  rootPageId?: string;
  beforeCommit?: (
    trx: KyselyTransaction,
    duplicatedRootPageId: string,
  ) => Promise<void>;
}

// Keep page-tree mutations for a space in a single, short critical section.
// The namespace avoids colliding with unrelated two-key advisory locks.
const PAGE_TREE_LOCK_NAMESPACE = 0x70616765;

@Injectable()
export class PageService {
  private readonly logger = new Logger(PageService.name);

  constructor(
    private pageRepo: PageRepo,
    private attachmentRepo: AttachmentRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
    @InjectQueue(QueueName.GENERAL_QUEUE) private generalQueue: Queue,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE) private notificationQueue: Queue,
    private eventEmitter: EventEmitter2,
    @Inject(COLLABORATION_DOCUMENT_PORT)
    private collaborationGateway: CollaborationDocumentPort,
    private readonly watcherService: WatcherService,
    private readonly recipientResolverService: RecipientResolverService,
    private readonly databaseRepo: DatabaseRepo,
    private readonly databaseRowRepo: DatabaseRowRepo,
    private readonly databaseCellRepo: DatabaseCellRepo,
    private readonly databasePropertyRepo: DatabasePropertyRepo,
    private readonly databaseViewRepo: DatabaseViewRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly userRepo: UserRepo,
    private readonly pageHistoryRecorder: PageHistoryRecorderService,
    private readonly pageAccessService: PageAccessService,
    private readonly pageAccessMutationService: PageAccessMutationService,
    private readonly transclusionService?: TransclusionService,
    @Optional() private readonly queueOutboxService?: QueueOutboxService,
    @Optional()
    private readonly pageTemplatePolicy?: PageTemplatePolicyService,
  ) {}

  async resolvePageDatabaseId(
    pageId: string,
    workspaceId: string,
  ): Promise<string | null> {
    const linkedDatabase = await this.databaseRepo.findByPageId(
      pageId,
      workspaceId,
    );
    if (linkedDatabase?.id) {
      return linkedDatabase.id;
    }

    const row = await this.databaseRowRepo.findActiveByPageId(
      pageId,
      workspaceId,
    );
    return row?.databaseId ?? null;
  }

  private async duplicateLinkedDatabases(params: {
    pageMap: Map<string, CopyPageMapEntry>;
    copiedPageByOriginalId: CopiedPageByOriginalId;
    spaceId: string;
    authUser: User;
    trx: KyselyTransaction;
  }) {
    const originalPageIds = Array.from(params.pageMap.keys());
    if (originalPageIds.length === 0) {
      return;
    }
    const duplicatedPageIdMap = new Map(
      Array.from(params.pageMap, ([pageId, entry]) => [
        pageId,
        entry.newPageId,
      ]),
    );

    const databases = await params.trx
      .selectFrom('databases')
      .selectAll()
      .where('pageId', 'in', originalPageIds)
      .where('deletedAt', 'is', null)
      .execute();

    for (const database of databases) {
      if (!database.pageId) {
        continue;
      }

      const copiedDatabasePage = params.pageMap.get(database.pageId);
      const copiedPage = params.copiedPageByOriginalId.get(database.pageId);
      if (!copiedDatabasePage || !copiedPage) {
        continue;
      }

      const newDatabaseId = uuid7();
      await params.trx
        .insertInto('databases')
        .values({
          id: newDatabaseId,
          spaceId: params.spaceId,
          name: copiedPage.title ?? database.name,
          description: database.description,
          descriptionContent: database.descriptionContent as never,
          icon: database.icon,
          workspaceId: database.workspaceId,
          creatorId: params.authUser.id,
          lastUpdatedById: params.authUser.id,
          pageId: copiedDatabasePage.newPageId,
        })
        .execute();

      const properties = await params.trx
        .selectFrom('databaseProperties')
        .selectAll()
        .where('databaseId', '=', database.id)
        .where('deletedAt', 'is', null)
        .orderBy('position', 'asc')
        .execute();

      const propertyIdMap = new Map<string, string>();
      for (const property of properties) {
        propertyIdMap.set(property.id, uuid7());
      }

      if (properties.length > 0) {
        await params.trx
          .insertInto('databaseProperties')
          .values(
            properties.map((property) => ({
              id: propertyIdMap.get(property.id)!,
              databaseId: newDatabaseId,
              workspaceId: property.workspaceId,
              name: property.name,
              type: property.type,
              settings: property.settings as never,
              position: property.position,
              creatorId: params.authUser.id,
            })),
          )
          .execute();
      }

      const rows = await params.trx
        .selectFrom('databaseRows')
        .selectAll()
        .where('databaseId', '=', database.id)
        .where('archivedAt', 'is', null)
        .execute();

      const copiedRows = rows.filter((row) => params.pageMap.has(row.pageId));
      const copiedRowPageIds = new Set(copiedRows.map((row) => row.pageId));
      if (copiedRows.length > 0) {
        await params.trx
          .insertInto('databaseRows')
          .values(
            copiedRows.map((row) => ({
              id: uuid7(),
              databaseId: newDatabaseId,
              workspaceId: row.workspaceId,
              pageId: params.pageMap.get(row.pageId)!.newPageId,
              createdById: params.authUser.id,
              updatedById: params.authUser.id,
            })),
          )
          .execute();
      }

      const propertyTypeById = new Map(
        properties.map((property) => [property.id, property.type]),
      );
      const cells = await params.trx
        .selectFrom('databaseCells')
        .selectAll()
        .where('databaseId', '=', database.id)
        .where('deletedAt', 'is', null)
        .execute();
      const copiedCells = cells.filter(
        (cell) =>
          copiedRowPageIds.has(cell.pageId) &&
          propertyIdMap.has(cell.propertyId),
      );

      if (copiedCells.length > 0) {
        await params.trx
          .insertInto('databaseCells')
          .values(
            copiedCells.map((cell) => ({
              id: uuid7(),
              databaseId: newDatabaseId,
              workspaceId: cell.workspaceId,
              pageId: params.pageMap.get(cell.pageId)!.newPageId,
              propertyId: propertyIdMap.get(cell.propertyId)!,
              value: remapDatabasePageReference(
                cell.value,
                propertyTypeById.get(cell.propertyId),
                duplicatedPageIdMap,
              ) as never,
              attachmentId: cell.attachmentId,
              createdById: params.authUser.id,
              updatedById: params.authUser.id,
            })),
          )
          .execute();
      }

      const views = await params.trx
        .selectFrom('databaseViews')
        .selectAll()
        .where('databaseId', '=', database.id)
        .where('deletedAt', 'is', null)
        .orderBy('createdAt', 'asc')
        .execute();

      if (views.length > 0) {
        await params.trx
          .insertInto('databaseViews')
          .values(
            views.map((view) => ({
              id: uuid7(),
              databaseId: newDatabaseId,
              workspaceId: view.workspaceId,
              name: view.name,
              type: view.type,
              config: remapDatabaseViewConfig(
                view.config,
                propertyIdMap,
              ) as never,
              creatorId: params.authUser.id,
            })),
          )
          .execute();
      }
    }
  }

  private async duplicateRowsInExistingDatabases(params: {
    pageMap: Map<string, CopyPageMapEntry>;
    authUser: User;
    trx: KyselyTransaction;
  }) {
    const originalPageIds = Array.from(params.pageMap.keys());
    if (originalPageIds.length === 0) {
      return;
    }
    const duplicatedPageIdMap = new Map(
      Array.from(params.pageMap, ([pageId, entry]) => [
        pageId,
        entry.newPageId,
      ]),
    );

    const [rows, copiedDatabases] = await Promise.all([
      params.trx
        .selectFrom('databaseRows')
        .selectAll()
        .where('pageId', 'in', originalPageIds)
        .where('archivedAt', 'is', null)
        .execute(),
      params.trx
        .selectFrom('databases')
        .selectAll()
        .where('pageId', 'in', originalPageIds)
        .where('deletedAt', 'is', null)
        .execute(),
    ]);

    const copiedDatabaseIds = new Set(
      copiedDatabases.map((database) => database.id),
    );
    const rowsToCopy = rows.filter(
      (row) =>
        !copiedDatabaseIds.has(row.databaseId) &&
        params.pageMap.has(row.pageId),
    );

    if (rowsToCopy.length === 0) {
      return;
    }

    await params.trx
      .insertInto('databaseRows')
      .values(
        rowsToCopy.map((row) => ({
          id: uuid7(),
          databaseId: row.databaseId,
          workspaceId: row.workspaceId,
          pageId: params.pageMap.get(row.pageId)!.newPageId,
          createdById: params.authUser.id,
          updatedById: params.authUser.id,
        })),
      )
      .execute();

    const rowsByDatabaseId = new Map<string, typeof rowsToCopy>();
    for (const row of rowsToCopy) {
      const databaseRows = rowsByDatabaseId.get(row.databaseId) ?? [];
      databaseRows.push(row);
      rowsByDatabaseId.set(row.databaseId, databaseRows);
    }

    for (const [databaseId, databaseRows] of rowsByDatabaseId) {
      const [properties, cells] = await Promise.all([
        params.trx
          .selectFrom('databaseProperties')
          .selectAll()
          .where('databaseId', '=', databaseId)
          .where('deletedAt', 'is', null)
          .execute(),
        params.trx
          .selectFrom('databaseCells')
          .selectAll()
          .where('databaseId', '=', databaseId)
          .where(
            'pageId',
            'in',
            databaseRows.map((row) => row.pageId),
          )
          .where('deletedAt', 'is', null)
          .execute(),
      ]);

      const propertyTypeById = new Map(
        properties.map((property) => [property.id, property.type]),
      );
      const activePropertyIds = new Set(propertyTypeById.keys());
      const cellsToCopy = cells.filter((cell) =>
        activePropertyIds.has(cell.propertyId),
      );

      if (cellsToCopy.length === 0) {
        continue;
      }

      await params.trx
        .insertInto('databaseCells')
        .values(
          cellsToCopy.map((cell) => ({
            id: uuid7(),
            databaseId: cell.databaseId,
            workspaceId: cell.workspaceId,
            pageId: params.pageMap.get(cell.pageId)!.newPageId,
            propertyId: cell.propertyId,
            value: remapDatabasePageReference(
              cell.value,
              propertyTypeById.get(cell.propertyId),
              duplicatedPageIdMap,
            ) as never,
            attachmentId: cell.attachmentId,
            createdById: params.authUser.id,
            updatedById: params.authUser.id,
          })),
        )
        .execute();
    }
  }

  private areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => value === right[index]);
  }

  private collectCustomFieldHistoryChanges(
    currentSettings: PageSettings | null,
    nextSettings: PageSettings | null,
    documentFields: {
      status?: boolean;
      assignee?: boolean;
      stakeholders?: boolean;
      aiRole?: boolean;
    },
  ): CustomFieldHistoryChange[] {
    const current = normalizePageSettings(currentSettings);
    const next = normalizePageSettings(nextSettings);
    const changes: CustomFieldHistoryChange[] = [];

    if (documentFields.status) {
      const previousStatus =
        typeof current.status === 'string' ? current.status : null;
      const nextStatus = typeof next.status === 'string' ? next.status : null;

      if (previousStatus !== nextStatus) {
        changes.push({
          field: 'status',
          oldValue: previousStatus,
          newValue: nextStatus,
        });
      }
    }

    if (documentFields.assignee) {
      const previousAssigneeId = getPageAssigneeId(current);
      const nextAssigneeId = getPageAssigneeId(next);

      if (previousAssigneeId !== nextAssigneeId) {
        changes.push({
          field: 'assigneeId',
          oldValue: previousAssigneeId,
          newValue: nextAssigneeId,
        });
      }
    }

    if (documentFields.stakeholders) {
      const previousStakeholderIds = getPageStakeholderIds(current);
      const nextStakeholderIds = getPageStakeholderIds(next);

      if (
        !this.areStringArraysEqual(previousStakeholderIds, nextStakeholderIds)
      ) {
        changes.push({
          field: 'stakeholderIds',
          oldValue: previousStakeholderIds,
          newValue: nextStakeholderIds,
        });
      }
    }

    if (documentFields.aiRole) {
      const previousAiRole = getPageAiRole(current);
      const nextAiRole = getPageAiRole(next);

      if (previousAiRole !== nextAiRole) {
        changes.push({
          field: 'aiRole',
          oldValue: previousAiRole,
          newValue: nextAiRole,
        });
      }
    }

    return changes;
  }

  private async resolveHistoryUserReferences(
    userIds: string[],
    workspaceId: string,
  ): Promise<Map<string, IHistoryUserRef>> {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return new Map();
    }

    const users = await Promise.all(
      uniqueUserIds.map(async (userId) => {
        const user = await this.userRepo.findById(userId, workspaceId);
        const name = user?.name?.trim() || userId;

        return [userId, { id: userId, name }] as const;
      }),
    );

    return new Map(users);
  }

  private toHistoryUserRef(
    value: unknown,
    usersById: Map<string, IHistoryUserRef>,
  ): IHistoryUserRef | null {
    if (typeof value !== 'string' || !value) {
      return null;
    }

    return usersById.get(value) ?? { id: value, name: value };
  }

  private toHistoryUserRefs(
    value: unknown,
    usersById: Map<string, IHistoryUserRef>,
  ): IHistoryUserRef[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .map((userId) => usersById.get(userId) ?? { id: userId, name: userId });
  }

  private async enrichCustomFieldHistoryChanges(
    changes: CustomFieldHistoryChange[],
    workspaceId: string,
  ): Promise<CustomFieldHistoryChange[]> {
    const userIds = changes.flatMap((change) => {
      if (change.field === 'assigneeId') {
        return [change.oldValue, change.newValue].filter(
          (value): value is string => typeof value === 'string',
        );
      }

      if (change.field === 'stakeholderIds') {
        return [
          ...(Array.isArray(change.oldValue) ? change.oldValue : []),
          ...(Array.isArray(change.newValue) ? change.newValue : []),
        ].filter((value): value is string => typeof value === 'string');
      }

      return [];
    });

    const usersById = await this.resolveHistoryUserReferences(
      userIds,
      workspaceId,
    );

    return changes.map((change) => {
      if (change.field === 'assigneeId') {
        return {
          ...change,
          oldValue: this.toHistoryUserRef(change.oldValue, usersById),
          newValue: this.toHistoryUserRef(change.newValue, usersById),
        };
      }

      if (change.field === 'stakeholderIds') {
        return {
          ...change,
          oldValue: this.toHistoryUserRefs(change.oldValue, usersById),
          newValue: this.toHistoryUserRefs(change.newValue, usersById),
        };
      }

      return change;
    });
  }

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
    internalOptions?: {
      pageId?: string;
      templateKind?: TemplateKind | null;
      trx?: KyselyTransaction;
      deferSideEffects?: boolean;
    },
  ): Promise<Page> {
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

    const persistPage = async (trx?: KyselyTransaction): Promise<Page> => {
      let parentPageId = undefined;
      let parentPage: Page = null;

      if (createPageDto.parentPageId) {
        if (!trx) {
          throw new Error('Page tree transaction is required');
        }

        await sql`select pg_advisory_xact_lock(${sql.lit(
          PAGE_TREE_LOCK_NAMESPACE,
        )}, hashtext(${createPageDto.spaceId}))`.execute(trx);

        parentPage = await this.pageRepo.findById(createPageDto.parentPageId, {
          withLock: true,
          trx,
        });

        if (
          !parentPage ||
          parentPage.deletedAt ||
          parentPage.templateKind !== null ||
          parentPage.spaceId !== createPageDto.spaceId
        ) {
          throw new NotFoundException('Parent page not found');
        }

        const parentDepth = await this.pageRepo.getPageDepth(
          parentPage.id,
          trx,
        );
        if (parentDepth + 1 > MAX_PAGE_TREE_DEPTH) {
          throw new BadRequestException(
            `Page tree depth cannot exceed ${MAX_PAGE_TREE_DEPTH}`,
          );
        }

        parentPageId = parentPage.id;
      }

      const page = await this.pageRepo.insertPage(
        {
          id: internalOptions?.pageId,
          slugId: generateSlugId(),
          title: createPageDto.title,
          position: await this.nextPagePosition(
            createPageDto.spaceId,
            parentPageId,
            trx,
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
          settings: stripLegacyHeadingNumberingSetting(createPageDto.settings),
          templateKind: internalOptions?.templateKind ?? null,
        },
        trx,
        false,
      );

      if (parentPageId && parentPage) {
        await this.pageAccessMutationService.copyParentRulesToChild(
          parentPageId,
          page,
          userId,
          trx,
        );
      }

      return page;
    };

    const page = createPageDto.parentPageId
      ? await executeTx(this.db, persistPage, internalOptions?.trx)
      : await persistPage(internalOptions?.trx);

    if (!internalOptions?.deferSideEffects) {
      await this.finalizeCreatedPage(page, userId);
    }

    return page;
  }

  async finalizeCreatedPage(page: Page, userId: string): Promise<void> {
    try {
      await this.userRepo.updatePageEditModeByPageId(
        userId,
        page.workspaceId,
        page.id,
        'edit',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to update edit mode for newly created page ${page.id}`,
        error,
      );
    }
    this.eventEmitter.emit(EventName.PAGE_CREATED, {
      pageIds: [page.id],
      workspaceId: page.workspaceId,
    });
    this.generalQueue
      .add(QueueJob.ADD_PAGE_WATCHERS, {
        userIds: [userId],
        pageId: page.id,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
      })
      .catch((err) =>
        this.logger.warn(`Failed to queue add-page-watchers: ${err.message}`),
      );
  }

  async nextPagePosition(
    spaceId: string,
    parentPageId?: string,
    trx?: KyselyTransaction,
  ) {
    let pagePosition: string;

    const lastPageQuery = (trx ?? this.db)
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
    await this.assertCanManageTemplateSource(page, user);
    const contributors = new Set<string>(page.contributorIds);
    contributors.add(user.id);
    const contributorIds = Array.from(contributors);

    const currentSettings = (page.settings as PageSettings | null) ?? null;
    const nextSettings = updatePageDto.toSettingsPayload(currentSettings);
    const resolvedNextSettings = (nextSettings ??
      currentSettings) as PageSettings | null;
    const statusChanged =
      normalizePageSettings(currentSettings).status !==
      normalizePageSettings(resolvedNextSettings).status;
    const space = await this.spaceRepo.findById(page.spaceId, page.workspaceId);
    const documentFields = (
      space?.settings as Record<string, unknown> | null
    )?.['documentFields'] as
      | {
          status?: boolean;
          assignee?: boolean;
          stakeholders?: boolean;
          aiRole?: boolean;
        }
      | undefined;
    const customFieldChanges = this.collectCustomFieldHistoryChanges(
      currentSettings,
      resolvedNextSettings,
      {
        status: !!documentFields?.status,
        assignee: !!documentFields?.assignee,
        stakeholders: !!documentFields?.stakeholders,
        aiRole: !!documentFields?.aiRole,
      },
    );

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
    const assignmentDelta =
      this.recipientResolverService.resolveAssignmentDelta(
        currentSettings,
        nextSettings ?? null,
      );
    const assignmentEventId = uuid7();

    if (assignmentDelta.newAssigneeId) {
      await this.notificationQueue.add(QueueJob.PAGE_RECIPIENT_NOTIFICATION, {
        eventId: assignmentEventId,
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
        eventId: assignmentEventId,
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

    if (customFieldChanges.length > 0) {
      const databaseId = await this.resolvePageDatabaseId(
        page.id,
        page.workspaceId,
      );
      const changesWithDisplayNames =
        await this.enrichCustomFieldHistoryChanges(
          customFieldChanges,
          page.workspaceId,
        );

      await this.pageHistoryRecorder.enqueuePageEvent({
        pageId: page.id,
        actorId: user.id,
        changeType: 'page.custom-fields.updated',
        changeData: {
          databaseId,
          changes: changesWithDisplayNames,
        },
      });
    }

    if (statusChanged) {
      this.eventEmitter.emit(EventName.RAG_SYNC_SCOPE_CHANGED, {
        spaceId: page.spaceId,
      });
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
    const sourcePage = await this.pageRepo.findById(pageId);
    if (sourcePage) {
      await this.assertCanManageTemplateSource(sourcePage, user);
    }
    const prosemirrorJson = await this.parseProsemirrorContent(content, format);
    await this.assertTemplateInstanceContentMutation(
      pageId,
      prosemirrorJson,
      operation,
    );

    const documentName = `page.${pageId}`;
    await this.collaborationGateway.updatePageContent(documentName, {
      operation,
      prosemirrorJson,
      user,
    });
  }

  private async assertTemplateInstanceContentMutation(
    pageId: string,
    prosemirrorJson: any,
    operation: ContentOperation,
  ): Promise<void> {
    const instance = await this.db
      .selectFrom('pageTemplateInstances')
      .select('id')
      .where('childPageId', '=', pageId)
      .where('instanceKind', '=', 'synced')
      .where('status', 'in', ['active', 'syncing', 'error'])
      .executeTakeFirst();
    if (!instance) return;

    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
    });
    if (!page) return;

    const current = getProsemirrorContent(page.content) as any;
    const incoming = getProsemirrorContent(prosemirrorJson) as any;
    const currentNodes = Array.isArray(current?.content) ? current.content : [];
    const incomingNodes = Array.isArray(incoming?.content)
      ? incoming.content
      : [];
    const next =
      operation === 'replace'
        ? incoming
        : {
            ...current,
            content:
              operation === 'prepend'
                ? [...incomingNodes, ...currentNodes]
                : [...currentNodes, ...incomingNodes],
          };

    if (!validateTemplateInstanceMutation(current, next)) {
      throw new ConflictException({
        code: 'page_template_managed_content_read_only',
        message:
          'Template-managed blocks can only be changed in the source template',
      });
    }
  }

  /**
   * Converts a regular page into a database.
   *
   * Within one transaction, a database record is created, after which
   * all current direct children of the page are bound as database rows.
   */
  async convertPageToDatabase(
    page: Page,
    actorId: string,
  ): Promise<{ databaseId: string; pageId: string }> {
    if (page.templateKind !== null) {
      throw new ConflictException({
        code: 'page_template_source_convert_forbidden',
        message: 'A template source cannot be converted to a database',
      });
    }
    const database = await executeTx(this.db, async (trx) => {
      const lockedPage = await this.pageRepo.findById(page.id, {
        withLock: true,
        trx,
      });
      if (
        !lockedPage ||
        lockedPage.deletedAt ||
        lockedPage.workspaceId !== page.workspaceId ||
        lockedPage.spaceId !== page.spaceId ||
        lockedPage.templateKind !== null
      ) {
        throw new NotFoundException('Page to convert not found');
      }
      if (
        await this.hasTemplateInPageTree(
          lockedPage.id,
          lockedPage.workspaceId,
          trx,
          false,
        )
      ) {
        throw new ConflictException({
          code: 'page_template_source_convert_forbidden',
          message:
            'Template source pages cannot be converted with their parent tree',
        });
      }
      if (
        await this.hasLinkedTemplateInstanceInPageTree(
          lockedPage.id,
          lockedPage.workspaceId,
          trx,
        )
      ) {
        throw new ConflictException({
          code: 'page_template_linked_page_convert_forbidden',
          message:
            'Detach synchronized template links before converting this page tree to a database',
        });
      }
      const descendants = await this.pageRepo.getPageAndDescendants(
        lockedPage.id,
        {
          includeContent: false,
          trx,
        },
      );
      const existingDatabase =
        await this.databaseRepo.findByPageIdIncludingDeleted(
          lockedPage.id,
          lockedPage.workspaceId,
        );

      const basePayload = {
        spaceId: lockedPage.spaceId,
        name: lockedPage.title?.trim() ?? '',
        icon: lockedPage.icon,
        description: null,
        workspaceId: lockedPage.workspaceId,
        creatorId: actorId,
        lastUpdatedById: actorId,
        pageId: lockedPage.id,
      };

      const restoredOrCreatedDatabase = existingDatabase
        ? await this.databaseRepo.restoreDatabase(
            existingDatabase.id,
            lockedPage.workspaceId,
            { lastUpdatedById: actorId },
            trx,
          )
        : await this.databaseRepo.insertDatabase(basePayload, trx);

      if (existingDatabase) {
        await this.databasePropertyRepo.restoreByDatabaseId(
          existingDatabase.id,
          lockedPage.workspaceId,
          trx,
        );
        await this.databaseViewRepo.restoreByDatabaseId(
          existingDatabase.id,
          lockedPage.workspaceId,
          trx,
        );
        await this.databaseCellRepo.restoreByDatabaseId(
          existingDatabase.id,
          lockedPage.workspaceId,
          trx,
        );
      }

      const descendantPageIds = descendants
        .map((descendant) => descendant.id)
        .filter((descendantPageId) => descendantPageId !== lockedPage.id);

      for (const descendantPageId of descendantPageIds) {
        const existingRow = await this.databaseRowRepo.findByDatabaseAndPage(
          restoredOrCreatedDatabase.id,
          descendantPageId,
        );

        if (existingRow) {
          await this.databaseRowRepo.restoreRowLink(
            restoredOrCreatedDatabase.id,
            descendantPageId,
            lockedPage.workspaceId,
            actorId,
            trx,
          );
          continue;
        }

        await this.databaseRowRepo.insertRow(
          {
            databaseId: restoredOrCreatedDatabase.id,
            pageId: descendantPageId,
            workspaceId: lockedPage.workspaceId,
            createdById: actorId,
            updatedById: actorId,
          },
          trx,
        );
      }

      return restoredOrCreatedDatabase;
    });

    await this.pageHistoryRecorder.recordPageEvent({
      pageId: page.id,
      actorId,
      changeType: 'page.converted.to-database',
      changeData: {
        databaseId: database.id,
        conversion: {
          direction: 'page-to-database',
        },
      },
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
        isLinkedTemplateInstance: boolean;
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
        // Important: here we use expression builder instead of raw SQL,
        // so that Kysely correctly generates EXISTS subqueries without
        // nested `AS ...` inside a boolean expression.
        sql<boolean>`case
          when ${eb.or([
            eb.exists(
              eb
                .selectFrom('pages as child')
                .select('child.id')
                .whereRef('child.parentPageId', '=', 'pages.id')
                .where('child.deletedAt', 'is', null)
                .where('child.templateKind', 'is', null),
            ),
            eb.exists(
              eb
                .selectFrom('databases as childDatabase')
                .innerJoin(
                  'pages as childPage',
                  'childPage.id',
                  'childDatabase.pageId',
                )
                .select('childDatabase.id')
                .where('childDatabase.deletedAt', 'is', null)
                .where('childPage.deletedAt', 'is', null)
                .whereRef('childPage.parentPageId', '=', 'pages.id'),
            ),
          ])}
          then true
          else false
        end`.as('hasChildren'),
        sql<boolean>`case
          when ${eb.exists(
            eb
              .selectFrom('pageTemplateInstances as sidebarInstance')
              .select('sidebarInstance.id')
              .whereRef('sidebarInstance.childPageId', '=', 'pages.id')
              .where('sidebarInstance.instanceKind', '=', 'synced')
              .where('sidebarInstance.status', 'in', [
                'active',
                'syncing',
                'error',
              ]),
          )}
          then true
          else false
        end`.as('isLinkedTemplateInstance'),
      ])
      .where('pages.deletedAt', 'is', null)
      .where('pages.templateKind', 'is', null)
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
          .innerJoin(
            'pages as databasePage',
            'databasePage.id',
            'databases.pageId',
          )
          .select([
            'databasePage.id as id',
            'databasePage.slugId as slugId',
            'databases.name as title',
            'databases.icon as icon',
            'databasePage.position as position',
            'databasePage.parentPageId as parentPageId',
            'databases.spaceId as spaceId',
            'databases.creatorId as creatorId',
            'databases.deletedAt as deletedAt',
            /**
             * It is important to use ref instead of raw SQL for camelCase aliases.
             *
             * PostgreSQL casts unquoted identifiers to lower
             * register (`databasepage`), which is why when raw accessing
             * `databasePage.settings` we get the missing FROM-clause error.
             */
            sql<any>`${this.db.dynamic.ref('databasePage.settings')}`.as(
              'settings',
            ),
            sql<string>`'database'`.as('nodeType'),
            'databases.id as databaseId',
          ])
          .select((eb) => [
            sql<boolean>`case
              when ${eb.exists(
                eb
                  .selectFrom('pages as childPage')
                  .innerJoin(
                    'databaseRows as childRow',
                    'childRow.pageId',
                    'childPage.id',
                  )
                  .select('childPage.id')
                  .whereRef('childPage.parentPageId', '=', 'databasePage.id')
                  .where('childPage.deletedAt', 'is', null)
                  .where('childRow.archivedAt', 'is', null),
              )}
              then true
              else false
            end`.as('hasChildren'),
            sql<boolean>`false`.as('isLinkedTemplateInstance'),
          ])
          .where('databases.deletedAt', 'is', null)
          .where('databasePage.deletedAt', 'is', null)
          .where('databases.spaceId', '=', spaceId)
          .$if(!!pageId, (qb) =>
            qb.where('databasePage.parentPageId', '=', pageId),
          )
          .$if(!pageId, (qb) =>
            qb.where('databasePage.parentPageId', 'is', null),
          ),
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
    const pageIds = await executeTx(this.db, async (trx) => {
      const lockedSpaceIds = [rootPage.spaceId, spaceId].sort();
      for (const lockedSpaceId of lockedSpaceIds) {
        await sql`select pg_advisory_xact_lock(${sql.lit(
          PAGE_TREE_LOCK_NAMESPACE,
        )}, hashtext(${lockedSpaceId}))`.execute(trx);
      }

      const lockedSpaces = await trx
        .selectFrom('spaces')
        .select(['id', 'archivedAt'])
        .where('workspaceId', '=', rootPage.workspaceId)
        .where('id', 'in', lockedSpaceIds)
        .forUpdate()
        .execute();
      if (
        lockedSpaces.length !== lockedSpaceIds.length ||
        lockedSpaces.some((space) => space.archivedAt !== null)
      ) {
        throw new NotFoundException('Source or destination space not found');
      }

      const lockedRootPage = await this.pageRepo.findById(rootPage.id, {
        withLock: true,
        trx,
      });
      if (
        !lockedRootPage ||
        lockedRootPage.deletedAt ||
        lockedRootPage.templateKind !== null ||
        lockedRootPage.workspaceId !== rootPage.workspaceId ||
        lockedRootPage.spaceId !== rootPage.spaceId
      ) {
        throw new NotFoundException('Page to move not found');
      }

      const rootDatabaseRow = await this.databaseRowRepo.findActiveByPageId(
        lockedRootPage.id,
        lockedRootPage.workspaceId,
        trx,
      );

      if (
        await this.hasTemplateInPageTree(
          lockedRootPage.id,
          lockedRootPage.workspaceId,
          trx,
          true,
        )
      ) {
        throw new ConflictException({
          code: 'page_template_source_move_forbidden',
          message:
            'Move template source pages separately instead of moving their parent tree to another space',
        });
      }

      const movedPages = await this.pageRepo.getPageAndDescendants(
        lockedRootPage.id,
        {
          includeContent: false,
          includeDeleted: true,
          trx,
        },
      );
      const movedPageIds = movedPages.map((page) => page.id);
      if (await this.hasLinkedTemplateInstance(movedPageIds, trx)) {
        throw new ConflictException({
          code: 'page_template_linked_page_move_forbidden',
          message:
            'Detach synchronized template links before moving this page tree to another space',
        });
      }

      // Update root page
      const nextPosition = await this.nextPagePosition(spaceId, undefined, trx);
      await this.pageRepo.updatePage(
        { spaceId, parentPageId: null, position: nextPosition },
        lockedRootPage.id,
        trx,
        false,
      );
      // The first id is the root page id
      if (movedPageIds.length > 1) {
        // Here we pass only the UUID `id`; The repository method also supports `slugId`.
        await this.pageRepo.updatePages(
          { spaceId },
          movedPageIds.filter((id) => id !== lockedRootPage.id),
          trx,
          false,
        );
      }

      if (movedPageIds.length > 0) {
        if (rootDatabaseRow) {
          await this.databaseRowRepo.archiveByPageIds(
            rootDatabaseRow.databaseId,
            lockedRootPage.workspaceId,
            movedPageIds,
            trx,
          );
        }

        await trx
          .updateTable('databases')
          .set({ spaceId, updatedAt: new Date() })
          .where('pageId', 'in', movedPageIds)
          .where('workspaceId', '=', lockedRootPage.workspaceId)
          .where('deletedAt', 'is', null)
          .execute();

        // update spaceId in shares
        await trx
          .updateTable('shares')
          .set({ spaceId: spaceId })
          .where('pageId', 'in', movedPageIds)
          .execute();

        // Update comments
        await trx
          .updateTable('comments')
          .set({ spaceId: spaceId })
          .where('pageId', 'in', movedPageIds)
          .execute();

        // Update attachments
        await this.attachmentRepo.updateAttachmentsByPageId(
          { spaceId },
          movedPageIds,
          trx,
        );

        // Page ACL rules are space-bound and must be reset when subtree moves to another space.
        await this.pageAccessMutationService.clearRulesByPageIds(
          movedPageIds,
          trx,
        );

        // Update watchers and remove those without access to new space
        await this.watcherService.movePageWatchersToSpace(
          movedPageIds,
          spaceId,
          { trx },
        );
      }

      return movedPageIds;
    });

    if (pageIds.length > 0) {
      this.eventEmitter.emit(EventName.PAGE_UPDATED, {
        pageIds,
        workspaceId: rootPage.workspaceId,
      });
    }
  }

  async duplicatePage(
    rootPage: Page,
    targetSpaceId: string | undefined,
    authUser: User,
    options?: DuplicatePageOptions,
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
    const sourceAccessByPageId =
      await this.pageAccessService.getEffectiveAccessForPages(pages, authUser);
    if (
      pages.length === 0 ||
      pages.some(
        (page) =>
          sourceAccessByPageId.get(page.id)?.capabilities.canRead !== true,
      )
    ) {
      throw new ForbiddenException();
    }

    if (
      await this.hasTemplateInPageTree(
        rootPage.id,
        rootPage.workspaceId,
        this.db,
        false,
      )
    ) {
      throw new ConflictException({
        code: 'page_template_source_duplicate_forbidden',
        message:
          'Use a template action instead of duplicating a template source page or its parent tree',
      });
    }
    if (await this.hasLinkedTemplateInstance(pages.map((page) => page.id))) {
      throw new ConflictException({
        code: 'page_template_linked_page_duplicate_forbidden',
        message:
          'Use the independent copy action or detach synchronized template links before duplicating this page tree',
      });
    }

    const referencingPageIdsByAttachmentId = new Map<string, Set<string>>();
    for (const page of pages) {
      const attachmentIds = getAttachmentIds(
        getProsemirrorContent(page.content),
      );
      for (const attachmentId of attachmentIds) {
        const referencingPageIds =
          referencingPageIdsByAttachmentId.get(attachmentId) ?? new Set();
        referencingPageIds.add(page.id);
        referencingPageIdsByAttachmentId.set(
          attachmentId,
          referencingPageIds,
        );
      }
    }

    const referencedAttachmentIds = [
      ...referencingPageIdsByAttachmentId.keys(),
    ];
    const sourceAttachmentPageIdById = new Map<string, string>();
    if (referencedAttachmentIds.length > 0) {
      const sourceAttachments = await this.attachmentRepo.findActiveByIds(
        referencedAttachmentIds,
        rootPage.workspaceId,
      );
      const sourceAttachmentById = new Map(
        sourceAttachments.map((attachment) => [attachment.id, attachment]),
      );

      for (const attachmentId of referencedAttachmentIds) {
        const sourceAttachment = sourceAttachmentById.get(attachmentId);
        const referencingPageIds =
          referencingPageIdsByAttachmentId.get(attachmentId);
        const referencingPageId =
          referencingPageIds?.size === 1
            ? referencingPageIds.values().next().value
            : undefined;
        if (
          !sourceAttachment ||
          !sourceAttachment.pageId ||
          !referencingPageId ||
          sourceAttachment.pageId !== referencingPageId
        ) {
          throw new ConflictException({
            code: 'page_attachment_source_invalid',
            message:
              'The page tree contains an attachment that cannot be duplicated safely',
          });
        }
        sourceAttachmentPageIdById.set(attachmentId, sourceAttachment.pageId);
      }
    }

    const pageMap = new Map<string, CopyPageMapEntry>();
    pages.forEach((page) => {
      pageMap.set(page.id, {
        newPageId:
          page.id === rootPage.id && options?.rootPageId
            ? options.rootPageId
            : uuid7(),
        newSlugId: generateSlugId(),
        oldSlugId: page.slugId,
      });
    });

    const attachmentMap = new Map<string, IDuplicatePageAttachmentMapping>();
    for (const [attachmentId, sourcePageId] of sourceAttachmentPageIdById) {
      attachmentMap.set(attachmentId, {
        newPageId: pageMap.get(sourcePageId).newPageId,
        oldPageId: sourcePageId,
        oldAttachmentId: attachmentId,
        newAttachmentId: uuid7(),
      });
    }

    const preparedPages = pages.map((page) => {
      const pageContent = getProsemirrorContent(page.content);
      const doc = jsonToNode(pageContent);
      return {
        page,
        prosemirrorDoc: removeMarkTypeFromDoc(doc, 'comment'),
      };
    });

    const insertablePages: InsertablePage[] = await Promise.all(
      preparedPages.map(async ({ page, prosemirrorDoc }) => {
        const pageFromMap = pageMap.get(page.id);

        // Update internal page links in mention nodes
        prosemirrorDoc.descendants((node: PMNode) => {
          if (isAttachmentNode(node.type.name)) {
            const attachmentId = node.attrs.attachmentId;
            const attachmentMapping = attachmentMap.get(attachmentId);
            if (attachmentMapping) {
              //@ts-ignore
              node.attrs.attachmentId = attachmentMapping.newAttachmentId;

              if (node.attrs.url) {
                //@ts-ignore
                node.attrs.url = node.attrs.url.replace(
                  attachmentId,
                  attachmentMapping.newAttachmentId,
                );
              }
              if (node.attrs.src) {
                //@ts-ignore
                node.attrs.src = node.attrs.src.replace(
                  attachmentId,
                  attachmentMapping.newAttachmentId,
                );
              }
            }
          }

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

          if (node.type.name === 'transclusionReference') {
            const sourcePageId = node.attrs.sourcePageId;
            if (sourcePageId && pageMap.has(sourcePageId)) {
              const mappedPage = pageMap.get(sourcePageId);
              //@ts-ignore
              node.attrs.sourcePageId = mappedPage.newPageId;
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
          settings: page.settings,
          templateKind: null,
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

    const copiedPageByOriginalId: CopiedPageByOriginalId = new Map(
      pages.map((page, index) => [page.id, insertablePages[index]]),
    );
    const attachmentMappings: IDuplicatePageAttachmentMapping[] = Array.from(
      attachmentMap.values(),
    );
    const newPageId = pageMap.get(rootPage.id).newPageId;

    await executeTx(this.db, async (trx) => {
      await trx.insertInto('pages').values(insertablePages).execute();
      await this.duplicateLinkedDatabases({
          pageMap,
          copiedPageByOriginalId,
          spaceId,
          authUser,
          trx,
      });
      if (isDuplicateInSameSpace) {
        await this.duplicateRowsInExistingDatabases({
            pageMap,
            authUser,
            trx,
        });
      }
      const transclusionPages = insertablePages.map((page) => ({
          id: page.id as string,
          workspaceId: page.workspaceId,
          content: page.content,
      }));
      if (this.transclusionService) {
        await this.transclusionService.insertTransclusionsForPages(
            transclusionPages,
            trx,
        );
        await this.transclusionService.insertReferencesForPages(
            transclusionPages,
            trx,
        );
      }
      if (attachmentMappings.length > 0) {
        if (!this.queueOutboxService) {
          throw new Error('Queue outbox service is unavailable');
        }
        await this.queueOutboxService.enqueueDuplicatePageAttachments(
            {
              workspaceId: rootPage.workspaceId,
              rootPageId: rootPage.id,
              newPageId,
              spaceId,
              attachmentMappings,
            },
            trx,
        );
      }
      await options?.beforeCommit?.(trx, newPageId);
    });

    const insertedPageIds = insertablePages.map((page) => page.id);
    this.eventEmitter.emit(EventName.PAGE_CREATED, {
      pageIds: insertedPageIds,
      workspaceId: authUser.workspaceId,
    });

    if (attachmentMappings.length > 0) {
      this.queueOutboxService!.kick();
    }

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

    const updateResult = await executeTx(this.db, async (trx) => {
      await sql`select pg_advisory_xact_lock(${sql.lit(
        PAGE_TREE_LOCK_NAMESPACE,
      )}, hashtext(${movedPage.spaceId}))`.execute(trx);

      // Re-read after acquiring the per-space lock. The controller snapshot can
      // be stale when another move committed while this request was waiting.
      const lockedMovedPage = await this.pageRepo.findById(dto.pageId, {
        withLock: true,
        trx,
      });
      if (
        !lockedMovedPage ||
        lockedMovedPage.deletedAt ||
        lockedMovedPage.templateKind !== null ||
        lockedMovedPage.spaceId !== movedPage.spaceId
      ) {
        throw new NotFoundException('Page not found');
      }

      let parentPageId: string | null | undefined = null;
      let targetParentDepth = -1;
      if (lockedMovedPage.parentPageId === dto.parentPageId) {
        parentPageId = undefined;
      } else if (dto.parentPageId) {
        const parentPage = await this.pageRepo.findById(dto.parentPageId, {
          withLock: true,
          trx,
        });
        if (
          !parentPage ||
          parentPage.deletedAt ||
          parentPage.templateKind !== null ||
          parentPage.spaceId !== lockedMovedPage.spaceId
        ) {
          throw new NotFoundException('Parent page not found');
        }

        const wouldCreateCycle = await this.pageRepo.hasSelfOrAncestor(
          parentPage.id,
          lockedMovedPage.id,
          trx,
        );

        if (wouldCreateCycle) {
          throw new BadRequestException(
            'Page cannot be moved under itself or one of its sub pages',
          );
        }

        targetParentDepth = await this.pageRepo.getPageDepth(
          parentPage.id,
          trx,
        );
        parentPageId = parentPage.id;
      }

      if (parentPageId !== undefined) {
        const subtreeHeight = await this.pageRepo.getSubtreeHeight(
          lockedMovedPage.id,
          trx,
        );
        if (targetParentDepth + 1 + subtreeHeight > MAX_PAGE_TREE_DEPTH) {
          throw new BadRequestException(
            `Page tree depth cannot exceed ${MAX_PAGE_TREE_DEPTH}`,
          );
        }
      }

      return this.pageRepo.updatePage(
        {
          position: dto.position,
          parentPageId,
        },
        dto.pageId,
        trx,
        false,
      );
    });

    if (!updateResult || updateResult.numUpdatedRows === 0n) {
      return;
    }

    // PageRepo normally emits this event immediately after an UPDATE. A move
    // defers it until after COMMIT so a transaction rollback cannot publish a
    // tree change that does not exist in PostgreSQL.
    this.eventEmitter.emit(EventName.PAGE_UPDATED, {
      pageIds: [dto.pageId],
      workspaceId: movedPage.workspaceId,
    });
    this.eventEmitter.emit(EventName.RAG_SYNC_SCOPE_CHANGED, {
      spaceId: movedPage.spaceId,
    });
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
            sql<number>`0`.as('level'),
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
                sql<number>`pa.level + 1`.as('level'),
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
              .where('p.deletedAt', 'is', null)
              .where(sql`pa.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH)),
          ),
      )
      .selectFrom('page_ancestors')
      // `level` only bounds the traversal; it must not leak into breadcrumbs.
      .select([
        'id',
        'slugId',
        'title',
        'icon',
        'position',
        'parentPageId',
        'spaceId',
        'deletedAt',
        'hasChildren',
      ])
      .orderBy('level', 'desc')
      .execute();

    return ancestors;
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
    const { pageIds, cleanupEnqueued } = await this.deletePageTreeAtomically({
      pageId,
      workspaceId,
      hardDelete: true,
    });
    if (cleanupEnqueued) this.queueOutboxService!.kick();

    if (pageIds.length > 0) {
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
    const { pageIds, spaceIds } = await this.deletePageTreeAtomically({
      pageId,
      workspaceId,
      deletedById: userId,
      hardDelete: false,
    });
    if (pageIds.length > 0) {
      this.eventEmitter.emit(EventName.PAGE_SOFT_DELETED, {
        pageIds,
        workspaceId,
      });
      for (const spaceId of spaceIds) {
        this.eventEmitter.emit(EventName.RAG_SYNC_SCOPE_CHANGED, { spaceId });
      }
    }
  }

  private async deletePageTreeAtomically(params: {
    pageId: string;
    workspaceId: string;
    hardDelete: boolean;
    deletedById?: string;
  }): Promise<{
    pageIds: string[];
    spaceIds: string[];
    cleanupEnqueued: boolean;
  }> {
    return executeTx(this.db, async (trx) => {
      const descendants = await trx
        .withRecursive('page_descendants', (db) =>
          db
            .selectFrom('pages')
            .select(['id', sql<number>`0`.as('level')])
            .where('id', '=', params.pageId)
            .where('workspaceId', '=', params.workspaceId)
            .unionAll((exp) =>
              exp
                .selectFrom('pages as child')
                .select([
                  'child.id',
                  sql<number>`descendant.level + 1`.as('level'),
                ])
                .innerJoin(
                  'page_descendants as descendant',
                  'descendant.id',
                  'child.parentPageId',
                )
                .where('child.workspaceId', '=', params.workspaceId)
                .where(
                  sql`descendant.level`,
                  '<',
                  sql.lit(MAX_PAGE_TREE_DEPTH),
                ),
            ),
        )
        .selectFrom('page_descendants')
        .select('id')
        .execute();
      const pageIds = descendants.map(({ id }) => id);
      if (pageIds.length === 0) {
        return { pageIds: [], spaceIds: [], cleanupEnqueued: false };
      }

      // Lock template source rows before checking linkage. createFromTemplate
      // takes the same source-page lock before inserting an instance, so either
      // the create commits first and is observed here or it sees the deletion.
      const lockedPages = await trx
        .selectFrom('pages')
        .select(['id', 'spaceId', 'templateKind'])
        .where('workspaceId', '=', params.workspaceId)
        .where(sql<boolean>`${sql.ref('id')} = any(${pageIds}::uuid[])`)
        .orderBy('id')
        .forUpdate()
        .execute();
      const lockedPageIds = lockedPages.map(({ id }) => id);
      const templatePageIds = lockedPages
        .filter(({ templateKind }) => templateKind === 'synced')
        .map(({ id }) => id);

      if (templatePageIds.length > 0) {
        const active = await trx
          .selectFrom('pageTemplateInstances')
          .select('id')
          .where(
            sql<boolean>`${sql.ref('templatePageId')} = any(${templatePageIds}::uuid[])`,
          )
          .where('status', 'in', ['active', 'syncing', 'error'])
          .limit(1)
          .executeTakeFirst();
        if (active) {
          throw new ConflictException({
            code: 'page_template_has_active_instances',
            message:
              'Detach every linked page before deleting this synchronized template',
          });
        }
      }

      if (params.hardDelete) {
        if (!this.queueOutboxService) {
          throw new Error('queue_outbox_unavailable');
        }
        const cleanupEnqueued =
          await this.queueOutboxService.enqueuePageAttachmentCleanup(
            lockedPageIds,
            params.pageId,
            params.workspaceId,
            trx,
          );
        await trx
          .deleteFrom('pages')
          .where(sql<boolean>`${sql.ref('id')} = any(${lockedPageIds}::uuid[])`)
          .execute();
        return {
          pageIds: lockedPageIds,
          spaceIds: [...new Set(lockedPages.map(({ spaceId }) => spaceId))],
          cleanupEnqueued,
        };
      } else {
        const deletedAt = new Date();
        await trx
          .updateTable('pages')
          .set({ deletedById: params.deletedById!, deletedAt })
          .where(sql<boolean>`${sql.ref('id')} = any(${lockedPageIds}::uuid[])`)
          .execute();
        await trx
          .deleteFrom('shares')
          .where(
            sql<boolean>`${sql.ref('pageId')} = any(${lockedPageIds}::uuid[])`,
          )
          .execute();
      }

      return {
        pageIds: lockedPageIds,
        spaceIds: [...new Set(lockedPages.map(({ spaceId }) => spaceId))],
        cleanupEnqueued: false,
      };
    });
  }

  private async assertCanManageTemplateSource(
    page: Page,
    user: User,
  ): Promise<void> {
    if (!page.templateKind) return;
    if (!this.pageTemplatePolicy) {
      throw new ConflictException({
        code: 'page_template_policy_unavailable',
        message: 'Page template policy is unavailable',
      });
    }
    await this.pageTemplatePolicy.assertAction(
      page.workspaceId,
      page.spaceId,
      user.id,
      'manage_template',
    );
  }

  private async hasLinkedTemplateInstance(
    pageIds: string[],
    trx: KyselyTransaction | KyselyDB = this.db,
  ): Promise<boolean> {
    if (pageIds.length === 0) return false;
    const instance = await trx
      .selectFrom('pageTemplateInstances')
      .select('id')
      .where('childPageId', 'in', pageIds)
      .where('instanceKind', '=', 'synced')
      .where('status', 'in', ['active', 'syncing', 'error'])
      .limit(1)
      .executeTakeFirst();
    return Boolean(instance);
  }

  private async hasLinkedTemplateInstanceInPageTree(
    pageId: string,
    workspaceId: string,
    trx: KyselyTransaction | KyselyDB = this.db,
  ): Promise<boolean> {
    const instance = await trx
      .withRecursive('page_descendants', (db) =>
        db
          .selectFrom('pages')
          .select(['id', sql<number>`0`.as('level')])
          .where('id', '=', pageId)
          .where('workspaceId', '=', workspaceId)
          .where('deletedAt', 'is', null)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as child')
              .select([
                'child.id',
                sql<number>`descendant.level + 1`.as('level'),
              ])
              .innerJoin(
                'page_descendants as descendant',
                'descendant.id',
                'child.parentPageId',
              )
              .where('child.workspaceId', '=', workspaceId)
              .where('child.deletedAt', 'is', null)
              .where(sql`descendant.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH)),
          ),
      )
      .selectFrom('page_descendants as descendant')
      .innerJoin(
        'pageTemplateInstances as instance',
        'instance.childPageId',
        'descendant.id',
      )
      .select('instance.id')
      .where('instance.instanceKind', '=', 'synced')
      .where('instance.status', 'in', ['active', 'syncing', 'error'])
      .limit(1)
      .executeTakeFirst();
    return Boolean(instance);
  }

  private async hasTemplateInPageTree(
    pageId: string,
    workspaceId: string,
    trx: KyselyTransaction | KyselyDB = this.db,
    includeDeleted = false,
  ): Promise<boolean> {
    const template = await trx
      .withRecursive('page_descendants', (db) =>
        db
          .selectFrom('pages')
          .select(['id', sql<number>`0`.as('level')])
          .where('id', '=', pageId)
          .where('workspaceId', '=', workspaceId)
          .$if(!includeDeleted, (query) => query.where('deletedAt', 'is', null))
          .unionAll((exp) =>
            exp
              .selectFrom('pages as child')
              .select([
                'child.id',
                sql<number>`descendant.level + 1`.as('level'),
              ])
              .innerJoin(
                'page_descendants as descendant',
                'descendant.id',
                'child.parentPageId',
              )
              .where('child.workspaceId', '=', workspaceId)
              .$if(!includeDeleted, (query) =>
                query.where('child.deletedAt', 'is', null),
              )
              .where(sql`descendant.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH)),
          ),
      )
      .selectFrom('page_descendants as descendant')
      .innerJoin('pages as template', 'template.id', 'descendant.id')
      .select('template.id')
      .where('template.workspaceId', '=', workspaceId)
      .where('template.templateKind', 'is not', null)
      .limit(1)
      .executeTakeFirst();
    return Boolean(template);
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
