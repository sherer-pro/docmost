jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
jest.mock('../../../collaboration/collaboration.util', () => ({
  ...jest.requireActual('../../../collaboration/collaboration.util'),
  strictJsonToNode: jest.fn(() => ({ type: { name: 'doc' } })),
}));
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import { PageTemplateService } from './page-template.service';
import { PageTemplateRuntimeService } from './page-template-runtime.service';
import { PageTemplateContentService } from './page-template-content.service';
import { PageTemplateOperationService } from './page-template-operation.service';
import { PageTemplatePublicationService } from './page-template-publication.service';
import { PageTemplateInstanceService } from './page-template-instance.service';
import { PageTemplateSyncService } from './page-template-sync.service';

const user = {
  id: '019fdaa0-0000-7000-8000-000000000010',
  workspaceId: '019fdaa0-0000-7000-8000-000000000020',
} as any;
const sourceSpaceId = '019fdaa0-0000-7000-8000-000000000030';
const targetSpaceId = '019fdaa0-0000-7000-8000-000000000040';
const sourcePageId = '019fdaa0-0000-7000-8000-000000000050';
const consumerPageId = '019fdaa0-0000-7000-8000-000000000060';

function buildService(options?: {
  db?: any;
  pageRepo?: any;
  pageService?: any;
  pageAccessService?: any;
  spaceAbility?: any;
  policy?: any;
  transclusion?: any;
  queueOutbox?: any;
  attachmentRepo?: any;
  storageService?: any;
  collaboration?: any;
}) {
  const pageRepo = options?.pageRepo ?? { findById: jest.fn() };
  const pageService =
    options?.pageService ??
    ({
      create: jest.fn(),
      finalizeCreatedPage: jest.fn().mockResolvedValue(undefined),
    } as any);
  const pageAccessService =
    options?.pageAccessService ??
    ({
      getEffectiveAccess: jest.fn(async () => ({
        capabilities: { canRead: true },
      })),
    } as any);
  const spaceAbility =
    options?.spaceAbility ??
    ({
      createForUser: jest.fn(async () => ({
        can: () => true,
        cannot: () => false,
      })),
    } as any);
  const policy =
    options?.policy ??
    ({ assertAction: jest.fn(), resolveForUser: jest.fn() } as any);
  const db = options?.db ?? ({} as any);
  const attachmentRepo = options?.attachmentRepo ?? ({} as any);
  const storageService = options?.storageService ?? ({} as any);
  const pageHistoryRecorder = {} as any;
  const content = new PageTemplateContentService(
    pageRepo,
    pageAccessService,
    spaceAbility,
    {} as any,
    {} as any,
    attachmentRepo,
    storageService,
    options?.collaboration ?? ({} as any),
  );
  const operations = new PageTemplateOperationService(
    db,
    pageRepo,
    attachmentRepo,
    storageService,
  );
  const publication = new PageTemplatePublicationService(db);
  const instance = new PageTemplateInstanceService(
    db,
    pageRepo,
    pageService,
    pageAccessService,
    spaceAbility,
    attachmentRepo,
    storageService,
    policy,
    options?.transclusion ?? ({} as any),
    pageHistoryRecorder,
    content,
    operations,
  );
  const sync = new PageTemplateSyncService(
    db,
    pageRepo,
    pageAccessService,
    policy,
    attachmentRepo,
    storageService,
    pageHistoryRecorder,
    content,
    operations,
    publication,
    options?.queueOutbox,
  );
  const service = new PageTemplateService(instance, sync);
  return {
    service,
    instance,
    sync,
    operations,
    publication,
    content,
    attachmentRepo,
    storageService,
    pageRepo,
    pageService,
    pageAccessService,
    spaceAbility,
    policy,
  };
}

describe('PageTemplateService space boundaries', () => {
  it('uses endpoint-specific versioned cursors and rejects invalid versions', () => {
    const { operations } = buildService();
    const pageCursor = operations.encodePageCursor({
      id: sourcePageId,
      updatedAt: new Date('2026-08-14T12:00:00.000Z'),
    });
    expect(operations.decodePageCursor(pageCursor)).toEqual({
      id: sourcePageId,
      updatedAt: new Date('2026-08-14T12:00:00.000Z'),
    });
    const revisionCursor = operations.encodeRevisionCursor({
      id: '019fdaa0-0000-7000-8000-000000000091',
      revision: 7,
    });
    expect(operations.decodeRevisionCursor(revisionCursor)).toEqual({
      id: '019fdaa0-0000-7000-8000-000000000091',
      revision: 7,
    });
    const wrongVersion = Buffer.from(
      JSON.stringify({
        version: 2,
        type: 'page',
        id: sourcePageId,
        updatedAt: '2026-08-14T12:00:00.000Z',
      }),
    ).toString('base64url');
    expect(() => operations.decodePageCursor(wrongVersion)).toThrow(
      BadRequestException,
    );
    expect(() => operations.decodeRevisionCursor(pageCursor)).toThrow(
      BadRequestException,
    );
  });

  it('resolves template capabilities from switches, actions, and page creation ability', async () => {
    const policy = {
      resolveForUser: jest.fn().mockResolvedValue({
        systemEnabled: true,
        workspaceEnabled: true,
        templatesEnabled: true,
        allowCreateTemplate: true,
        allowRegularTemplate: false,
        allowSyncedTemplate: true,
        allowedActions: [
          'create_template',
          'manage_template',
          'use_regular_template',
          'use_synced_template',
        ],
      }),
    };
    const spaceAbility = {
      createForUser: jest.fn().mockResolvedValue({
        can: jest.fn().mockReturnValue(true),
      }),
    };
    const { instance } = buildService({ policy, spaceAbility });

    await expect(
      instance.getCapabilities(sourceSpaceId, user),
    ).resolves.toEqual({
      capabilities: {
        enabled: true,
        createTemplate: true,
        manageTemplate: true,
        useRegular: false,
        useSynced: true,
      },
    });
  });

  it('archives and restores a managed template idempotently', async () => {
    const pageRepo = { updatePage: jest.fn().mockResolvedValue(undefined) };
    const { instance } = buildService({ pageRepo });
    jest
      .spyOn(instance as any, 'requireManagedTemplate')
      .mockResolvedValueOnce({
        id: sourcePageId,
        templateArchivedAt: null,
      })
      .mockResolvedValueOnce({
        id: sourcePageId,
        templateArchivedAt: new Date(),
      });

    await expect(instance.archive(sourcePageId, user)).resolves.toMatchObject({
      archived: true,
      archiveState: 'archived',
    });
    await expect(instance.restore(sourcePageId, user)).resolves.toMatchObject({
      archived: false,
      archiveState: 'active',
    });
    expect(pageRepo.updatePage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ templateArchivedAt: expect.any(Date) }),
      sourcePageId,
    );
    expect(pageRepo.updatePage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ templateArchivedAt: null }),
      sourcePageId,
    );
  });

  it('keeps detached instances out of usage pagination and counts', async () => {
    const query: any = {};
    for (const method of ['innerJoin', 'select', 'where']) {
      query[method] = jest.fn(() => query);
    }
    query.executeTakeFirst = jest.fn().mockResolvedValue({
      totalCount: 0,
      readableCount: 0,
    });
    const pageAccessService = {
      isWorkspaceBypassUser: jest.fn().mockReturnValue(false),
      getSidebarAccessSnapshot: jest.fn(),
      getEffectiveAccessForPages: jest.fn(),
    };
    const trx = { selectFrom: jest.fn(() => query) };
    const transactionBuilder: any = {};
    transactionBuilder.setIsolationLevel = jest.fn(() => transactionBuilder);
    transactionBuilder.execute = jest.fn(
      (callback: (value: any) => Promise<unknown>) => callback(trx),
    );
    const { instance } = buildService({
      db: { transaction: jest.fn(() => transactionBuilder) },
      pageAccessService,
    });
    jest.spyOn(instance as any, 'requireManagedTemplate').mockResolvedValue({
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
    });

    await expect(
      instance.listUsages(sourcePageId, { limit: 20 }, user),
    ).resolves.toEqual({
      totalCount: 0,
      hiddenCount: 0,
      items: [],
      nextCursor: null,
    });
    expect(query.where).toHaveBeenCalledWith('instance.status', 'in', [
      'snapshot',
      'active',
      'syncing',
      'error',
    ]);
    expect(transactionBuilder.setIsolationLevel).toHaveBeenCalledWith(
      'repeatable read',
    );
    expect(pageAccessService.getSidebarAccessSnapshot).not.toHaveBeenCalled();
    expect(pageAccessService.getEffectiveAccessForPages).not.toHaveBeenCalled();
  });

  it('uses exact SQL ACL counts and stable usage keyset pagination without whole-space reads', async () => {
    const usagePageIds = [
      '019fdaa0-0000-7000-8000-000000000101',
      '019fdaa0-0000-7000-8000-000000000102',
      '019fdaa0-0000-7000-8000-000000000103',
    ];
    const firstPageRows = [
      {
        childPageId: usagePageIds[2],
        status: 'active',
        appliedRevision: 3,
        lastErrorCode: null,
        slugId: 'page-3-slug',
        title: 'Page 3',
        icon: null,
        updatedAt: new Date('2026-08-14T12:03:00.000Z'),
      },
      {
        childPageId: usagePageIds[1],
        status: 'error',
        appliedRevision: 2,
        lastErrorCode: 'page_template_child_missing',
        slugId: 'page-2-slug',
        title: 'Page 2',
        icon: null,
        updatedAt: new Date('2026-08-14T12:02:00.000Z'),
      },
      {
        childPageId: usagePageIds[0],
        status: 'active',
        appliedRevision: 1,
        lastErrorCode: null,
        slugId: 'page-1-slug',
        title: 'Page 1',
        icon: null,
        updatedAt: new Date('2026-08-14T12:01:00.000Z'),
      },
    ];
    const makeQuery = (options: {
      counts?: { totalCount: number; readableCount: number };
      rows?: unknown[];
    }) => {
      const query: any = {};
      for (const method of [
        'innerJoin',
        'select',
        'where',
        'orderBy',
        'limit',
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.$if = jest.fn(
        (condition: boolean, callback: (value: any) => any) =>
          condition ? callback(query) : query,
      );
      query.executeTakeFirst = jest.fn().mockResolvedValue(options.counts);
      query.execute = jest.fn().mockResolvedValue(options.rows ?? []);
      return query;
    };
    const firstItemQuery = makeQuery({ rows: firstPageRows });
    const secondItemQuery = makeQuery({ rows: [firstPageRows[2]] });
    const queries = [
      makeQuery({ counts: { totalCount: 1002, readableCount: 3 } }),
      firstItemQuery,
      makeQuery({ counts: { totalCount: 1002, readableCount: 3 } }),
      secondItemQuery,
    ];
    const pageRepo = { findById: jest.fn() };
    const pageAccessService = {
      isWorkspaceBypassUser: jest.fn().mockReturnValue(false),
      getSidebarAccessSnapshot: jest.fn(),
      getEffectiveAccessForPages: jest.fn(),
    };
    const trx = { selectFrom: jest.fn(() => queries.shift()) };
    const transactionBuilder: any = {};
    transactionBuilder.setIsolationLevel = jest.fn(() => transactionBuilder);
    transactionBuilder.execute = jest.fn(
      (callback: (value: any) => Promise<unknown>) => callback(trx),
    );
    const { instance } = buildService({
      db: { transaction: jest.fn(() => transactionBuilder) },
      pageRepo,
      pageAccessService,
    });
    jest.spyOn(instance as any, 'requireManagedTemplate').mockResolvedValue({
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
    });

    const first = await instance.listUsages(sourcePageId, { limit: 2 }, user);
    expect(first).toMatchObject({
      totalCount: 1002,
      hiddenCount: 999,
      items: [
        { childPageId: usagePageIds[2] },
        {
          childPageId: usagePageIds[1],
          lastErrorCode: 'page_template_child_missing',
        },
      ],
    });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(
      JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8')),
    ).toEqual({
      version: 1,
      updatedAt: '2026-08-14T12:02:00.000Z',
      id: usagePageIds[1],
    });

    const second = await instance.listUsages(
      sourcePageId,
      { limit: 2, cursor: first.nextCursor! },
      user,
    );
    expect(second).toMatchObject({
      totalCount: 1002,
      hiddenCount: 999,
      items: [{ childPageId: usagePageIds[0] }],
      nextCursor: null,
    });
    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(firstItemQuery.execute).toHaveBeenCalledTimes(1);
    expect(secondItemQuery.execute).toHaveBeenCalledTimes(1);
    expect(pageAccessService.getSidebarAccessSnapshot).not.toHaveBeenCalled();
    expect(pageAccessService.getEffectiveAccessForPages).not.toHaveBeenCalled();
    expect(transactionBuilder.setIsolationLevel).toHaveBeenCalledTimes(2);
    const aclFilter = firstItemQuery.where.mock.calls
      .map(([value]) => value)
      .find(
        (value) =>
          value && typeof (value as any).toOperationNode === 'function',
      ) as any;
    const pendingNodes = [aclFilter.toOperationNode()];
    let arrayParameterFound = false;
    while (pendingNodes.length > 0) {
      const node = pendingNodes.pop();
      if (node?.kind === 'ValueNode' && Array.isArray(node.value)) {
        arrayParameterFound = true;
        break;
      }
      if (Array.isArray(node?.parameters)) {
        pendingNodes.push(...node.parameters);
      }
    }
    expect(arrayParameterFound).toBe(false);
  });

  it('keeps usage counts and rows on one ACL snapshot when access is revoked between phases', async () => {
    const revokedPageId = '019fdaa0-0000-7000-8000-000000000110';
    const row = {
      childPageId: revokedPageId,
      status: 'active',
      appliedRevision: 1,
      lastErrorCode: null,
      slugId: 'revoked-page',
      title: 'Visible in the transaction snapshot',
      icon: null,
      updatedAt: new Date('2026-08-14T12:00:00.000Z'),
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      parentPageId: null,
      deletedAt: null,
    };
    const makeQuery = () => {
      const query: any = {};
      for (const method of [
        'innerJoin',
        'select',
        'where',
        'orderBy',
        'limit',
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.$if = jest.fn(
        (condition: boolean, callback: (value: any) => any) =>
          condition ? callback(query) : query,
      );
      return query;
    };
    let liveReadable = true;
    let revokeAfterFirstCount = true;
    const transactionBuilder: any = {};
    transactionBuilder.setIsolationLevel = jest.fn(() => transactionBuilder);
    transactionBuilder.execute = jest.fn(
      async (callback: (value: any) => Promise<unknown>) => {
        const readableAtTransactionStart = liveReadable;
        let queryIndex = 0;
        const trx = {
          selectFrom: jest.fn(() => {
            const query = makeQuery();
            if (queryIndex++ === 0) {
              query.executeTakeFirst = jest.fn(async () => {
                if (revokeAfterFirstCount) {
                  liveReadable = false;
                  revokeAfterFirstCount = false;
                }
                return {
                  totalCount: 1,
                  readableCount: readableAtTransactionStart ? 1 : 0,
                };
              });
            } else {
              query.execute = jest
                .fn()
                .mockResolvedValue(readableAtTransactionStart ? [row] : []);
            }
            return query;
          }),
        };
        return callback(trx);
      },
    );
    const pageAccessService = {
      isWorkspaceBypassUser: jest.fn().mockReturnValue(false),
      getSidebarAccessSnapshot: jest.fn(),
      getEffectiveAccessForPages: jest.fn(),
    };
    const { instance } = buildService({
      db: { transaction: jest.fn(() => transactionBuilder) },
      pageAccessService,
    });
    jest.spyOn(instance as any, 'requireManagedTemplate').mockResolvedValue({
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
    });

    await expect(
      instance.listUsages(sourcePageId, { limit: 20 }, user),
    ).resolves.toMatchObject({
      totalCount: 1,
      hiddenCount: 0,
      items: [{ childPageId: revokedPageId }],
      nextCursor: null,
    });
    await expect(
      instance.listUsages(sourcePageId, { limit: 20 }, user),
    ).resolves.toEqual({
      totalCount: 1,
      hiddenCount: 1,
      items: [],
      nextCursor: null,
    });
    expect(pageAccessService.getSidebarAccessSnapshot).not.toHaveBeenCalled();
    expect(pageAccessService.getEffectiveAccessForPages).not.toHaveBeenCalled();
  });

  it('replays a completed create-template operation without creating another page', async () => {
    const completedPage = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    };
    const pageRepo = { findById: jest.fn().mockResolvedValue(completedPage) };
    const pageService = {
      create: jest.fn(),
      finalizeCreatedPage: jest.fn().mockResolvedValue(undefined),
    };
    const policy = {
      assertAction: jest.fn().mockRejectedValue(new Error('disabled now')),
    };
    const pageAccessService = {
      assertCanReadPage: jest.fn().mockResolvedValue(undefined),
    };
    const { instance, content, operations } = buildService({
      pageRepo,
      pageService,
      policy,
      pageAccessService,
    });
    const assertCanCreate = jest
      .spyOn(content, 'assertCanCreate')
      .mockRejectedValue(new Error('destination disabled now'));
    jest
      .spyOn(operations, 'findCompletedOperation')
      .mockResolvedValueOnce({
        id: 'operation-1',
        resultPageId: sourcePageId,
        afterContentHash: null,
      })
      .mockResolvedValueOnce({
        id: 'operation-1',
        resultPageId: sourcePageId,
        afterContentHash: 'finalized-content-hash',
      });
    jest
      .spyOn(operations, 'claimCreatedPageFinalization')
      .mockResolvedValue('finalization-lease');
    const completeFinalization = jest
      .spyOn(operations, 'completeCreatedPageFinalization')
      .mockResolvedValue(true);
    jest
      .spyOn(operations, 'releaseCreatedPageFinalization')
      .mockResolvedValue(undefined);

    await expect(
      instance.createTemplate(
        { spaceId: sourceSpaceId, kind: 'regular' },
        'create-key',
        user,
      ),
    ).resolves.toEqual({ page: completedPage, idempotent: true });
    await expect(
      instance.createTemplate(
        { spaceId: sourceSpaceId, kind: 'regular' },
        'create-key',
        user,
      ),
    ).resolves.toEqual({ page: completedPage, idempotent: true });
    expect(operations.findCompletedOperation).toHaveBeenCalledWith(
      'snapshot',
      'create-template:create-key',
      user,
      { spaceId: sourceSpaceId, kind: 'regular' },
    );
    expect(pageService.create).not.toHaveBeenCalled();
    expect(policy.assertAction).not.toHaveBeenCalled();
    expect(assertCanCreate).not.toHaveBeenCalled();
    expect(pageService.finalizeCreatedPage).toHaveBeenCalledTimes(1);
    expect(completeFinalization).toHaveBeenCalledWith(
      'operation-1',
      'finalization-lease',
      completedPage.content,
    );
  });

  it('replays a completed create-from-template operation before current source and policy checks', async () => {
    const completedPage = {
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    };
    const pageService = {
      create: jest.fn(),
      finalizeCreatedPage: jest.fn().mockResolvedValue(undefined),
    };
    const { instance, content, operations, policy } = buildService({
      pageRepo: { findById: jest.fn().mockResolvedValue(completedPage) },
      pageService,
      pageAccessService: {
        assertCanReadPage: jest.fn().mockResolvedValue(undefined),
      },
      policy: {
        assertAction: jest.fn().mockRejectedValue(new Error('disabled now')),
      },
    });
    const requireSource = jest
      .spyOn(content, 'requireTemplateSource')
      .mockRejectedValue(new Error('source archived now'));
    jest.spyOn(operations, 'findCompletedOperation').mockResolvedValue({
      id: 'operation-from-template',
      resultPageId: consumerPageId,
      afterContentHash: null,
    });
    jest
      .spyOn(operations, 'claimCreatedPageFinalization')
      .mockResolvedValue('finalization-lease');
    const completeFinalization = jest
      .spyOn(operations, 'completeCreatedPageFinalization')
      .mockResolvedValue(true);
    jest
      .spyOn(operations, 'releaseCreatedPageFinalization')
      .mockResolvedValue(undefined);

    await expect(
      instance.createFromTemplate(
        { templatePageId: sourcePageId, spaceId: sourceSpaceId },
        'snapshot-key',
        user,
      ),
    ).resolves.toEqual({ page: completedPage, idempotent: true });

    expect(requireSource).not.toHaveBeenCalled();
    expect(policy.assertAction).not.toHaveBeenCalled();
    expect(pageService.finalizeCreatedPage).toHaveBeenCalledWith(
      completedPage,
      user.id,
    );
    expect(completeFinalization).toHaveBeenCalledWith(
      'operation-from-template',
      'finalization-lease',
      completedPage.content,
    );
  });

  it('fences a recovered created page before running shared finalization', async () => {
    const recoveredPage = {
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
    } as any;
    const events: string[] = [];
    const { instance, operations } = buildService({
      pageRepo: { findById: jest.fn().mockResolvedValue(recoveredPage) },
    });
    jest.spyOn(operations, 'completeOperation').mockImplementation(async () => {
      events.push('operation-completed');
      return true;
    });
    jest
      .spyOn(instance as any, 'finalizeCreatedPageOperation')
      .mockImplementation(async () => {
        events.push('page-finalized');
      });

    await expect(
      (instance as any).resolveCreatedPageOperation(
        {
          id: 'operation-recovered',
          status: 'pending',
          resultPageId: consumerPageId,
          leaseToken: 'operation-lease',
        },
        user,
        'missing result',
      ),
    ).resolves.toEqual({ page: recoveredPage, idempotent: true });
    expect(events).toEqual(['operation-completed', 'page-finalized']);
  });

  it('persists shared attachment and transclusion side effects in order', async () => {
    const events: string[] = [];
    const trx = {} as any;
    const attachment = { id: 'attachment-1' };
    const attachmentRepo = {
      insertAttachment: jest.fn(async () => events.push('attachment')),
    };
    const transclusion = {
      insertTransclusionsForPages: jest.fn(async () =>
        events.push('transclusions'),
      ),
      insertReferencesForPages: jest.fn(async () =>
        events.push('references'),
      ),
    };
    const { instance } = buildService({ attachmentRepo, transclusion });
    const createdPage = {
      id: consumerPageId,
      workspaceId: user.workspaceId,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    } as any;

    await (instance as any).persistCreatedPageSideEffects(
      createdPage,
      [attachment],
      trx,
    );

    expect(events).toEqual(['attachment', 'transclusions', 'references']);
    expect(attachmentRepo.insertAttachment).toHaveBeenCalledWith(
      attachment,
      trx,
    );
    expect(transclusion.insertTransclusionsForPages).toHaveBeenCalledWith(
      [
        {
          id: consumerPageId,
          workspaceId: user.workspaceId,
          content: createdPage.content,
        },
      ],
      trx,
    );
    expect(transclusion.insertReferencesForPages).toHaveBeenCalledWith(
      expect.any(Array),
      trx,
    );
  });

  it('claims deferred finalization once across concurrent completed replays', async () => {
    const completedPage = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    };
    let releaseFinalization: () => void = () => undefined;
    let signalStarted: () => void = () => undefined;
    const finalizationReleased = new Promise<void>((resolve) => {
      releaseFinalization = resolve;
    });
    const finalizationStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const pageService = {
      create: jest.fn(),
      finalizeCreatedPage: jest.fn(async () => {
        signalStarted();
        await finalizationReleased;
      }),
    };
    const { instance, operations } = buildService({
      pageRepo: { findById: jest.fn().mockResolvedValue(completedPage) },
      pageService,
      pageAccessService: {
        assertCanReadPage: jest.fn().mockResolvedValue(undefined),
      },
    });
    jest.spyOn(operations, 'findCompletedOperation').mockResolvedValue({
      id: 'operation-concurrent',
      resultPageId: sourcePageId,
      afterContentHash: null,
    });
    let claimed = false;
    const claimFinalization = jest
      .spyOn(operations, 'claimCreatedPageFinalization')
      .mockImplementation(async () => {
        if (claimed) return null;
        claimed = true;
        return 'finalization-lease';
      });
    const completeFinalization = jest
      .spyOn(operations, 'completeCreatedPageFinalization')
      .mockResolvedValue(true);
    jest
      .spyOn(operations, 'releaseCreatedPageFinalization')
      .mockResolvedValue(undefined);

    const firstReplay = instance.createTemplate(
      { spaceId: sourceSpaceId, kind: 'regular' },
      'concurrent-key',
      user,
    );
    await finalizationStarted;
    const secondReplay = instance.createTemplate(
      { spaceId: sourceSpaceId, kind: 'regular' },
      'concurrent-key',
      user,
    );
    await expect(secondReplay).resolves.toEqual({
      page: completedPage,
      idempotent: true,
    });
    releaseFinalization();
    await expect(firstReplay).resolves.toEqual({
      page: completedPage,
      idempotent: true,
    });

    expect(claimFinalization).toHaveBeenCalledTimes(2);
    expect(pageService.finalizeCreatedPage).toHaveBeenCalledTimes(1);
    expect(completeFinalization).toHaveBeenCalledTimes(1);
  });

  it('replays a completed independent copy before current linkage and destination checks', async () => {
    const completedPage = {
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
    };
    const pageService = {
      create: jest.fn(),
      finalizeCreatedPage: jest.fn().mockResolvedValue(undefined),
    };
    const { instance, content, operations } = buildService({
      pageRepo: { findById: jest.fn().mockResolvedValue(completedPage) },
      pageService,
      pageAccessService: {
        assertCanReadPage: jest.fn().mockResolvedValue(undefined),
      },
    });
    const requirePlainDocument = jest
      .spyOn(content, 'requirePlainDocument')
      .mockRejectedValue(new Error('link detached now'));
    const assertCanCreate = jest.spyOn(content, 'assertCanCreate');
    jest.spyOn(operations, 'findCompletedOperation').mockResolvedValue({
      id: 'operation-independent',
      resultPageId: consumerPageId,
      afterContentHash: 'finalized-content-hash',
    });

    await expect(
      instance.createIndependentCopy(
        sourcePageId,
        { title: 'Independent' },
        'independent-key',
        user,
      ),
    ).resolves.toEqual({ page: completedPage, idempotent: true });

    expect(requirePlainDocument).not.toHaveBeenCalled();
    expect(assertCanCreate).not.toHaveBeenCalled();
    expect(pageService.finalizeCreatedPage).not.toHaveBeenCalled();
  });

  it.each(['active', 'syncing', 'error'])(
    'rejects a direct create-template request from a %s linked source',
    async (status) => {
      const query: any = {};
      for (const method of ['select', 'where']) {
        query[method] = jest.fn(() => query);
      }
      query.executeTakeFirst = jest.fn().mockResolvedValue({
        id: 'linked-instance',
        status,
      });
      const pageAccessService = {
        assertCanReadPage: jest.fn().mockResolvedValue(undefined),
      };
      const { instance, content, operations } = buildService({
        db: { selectFrom: jest.fn(() => query) },
        pageAccessService,
      });
      jest.spyOn(operations, 'findCompletedOperation').mockResolvedValue(null);
      jest.spyOn(content, 'assertCanCreate').mockResolvedValue(undefined);
      jest.spyOn(content, 'requirePlainDocument').mockResolvedValue({
        id: consumerPageId,
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
        deletedAt: null,
      } as any);
      const beginOperation = jest.spyOn(operations, 'beginOperation');

      await expect(
        instance.createTemplate(
          {
            spaceId: sourceSpaceId,
            kind: 'regular',
            sourcePageId: consumerPageId,
          },
          `linked-${status}`,
          user,
        ),
      ).rejects.toMatchObject({
        response: { code: 'page_template_linked_source_forbidden' },
      });
      expect(beginOperation).not.toHaveBeenCalled();
    },
  );

  it('allows a detached linked source to proceed as a plain template source', async () => {
    const query: any = {};
    for (const method of ['select', 'where']) {
      query[method] = jest.fn(() => query);
    }
    query.executeTakeFirst = jest.fn().mockResolvedValue(undefined);
    const { instance, content, operations } = buildService({
      db: { selectFrom: jest.fn(() => query) },
      pageAccessService: {
        assertCanReadPage: jest.fn().mockResolvedValue(undefined),
      },
    });
    jest.spyOn(operations, 'findCompletedOperation').mockResolvedValue(null);
    jest.spyOn(content, 'assertCanCreate').mockResolvedValue(undefined);
    jest.spyOn(content, 'requirePlainDocument').mockResolvedValue({
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
    } as any);
    const reachedOperation = new Error('reached_operation');
    const beginOperation = jest
      .spyOn(operations, 'beginOperation')
      .mockRejectedValue(reachedOperation);

    await expect(
      instance.createTemplate(
        {
          spaceId: sourceSpaceId,
          kind: 'regular',
          sourcePageId: consumerPageId,
        },
        'detached-source',
        user,
      ),
    ).rejects.toBe(reachedOperation);
    expect(beginOperation).toHaveBeenCalledTimes(1);
  });

  it('rejects a fresh publish key when the draft has no changes', async () => {
    const draft = { type: 'doc', content: [{ type: 'paragraph' }] };
    const draftHash = hashProseMirrorJson(draft as any);
    const template = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      templateKind: 'synced',
      templateArchivedAt: null,
      updatedAt: new Date('2026-08-14T12:00:00.000Z'),
    };
    const revision = { id: 'revision', contentHash: draftHash };
    const run = { id: 'run', status: 'completed' };
    const { sync, content, operations, publication } = buildService();
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue(template);
    jest.spyOn(content, 'getLiveContent').mockResolvedValue(draft);
    jest
      .spyOn(publication, 'normalizeDraftForPublication')
      .mockImplementation((value) => value as any);
    jest
      .spyOn(operations, 'findCompletedOperation')
      .mockResolvedValue(undefined);
    const beginOperation = jest.spyOn(operations, 'beginOperation');
    jest
      .spyOn(sync as any, 'findLatestPublishedResult')
      .mockResolvedValue({ revision, run, noOp: true });
    await expect(
      sync.publish(sourcePageId, { draftHash }, 'publish-no-op', user),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_template_no_changes',
      }),
    });
    expect(beginOperation).not.toHaveBeenCalled();
  });

  it('replays the exact completed publish result by idempotency key', async () => {
    const template = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      templateKind: 'synced',
      templateArchivedAt: null,
    };
    const revision = { id: 'revision' };
    const run = { id: 'run' };
    const { sync, content, operations, publication } = buildService();
    const requireManaged = jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue(template);
    const getLiveContent = jest.spyOn(content, 'getLiveContent');
    jest.spyOn(operations, 'findCompletedOperation').mockResolvedValue({
      stagedContent: { type: 'page_template_publish_result' },
    });
    jest
      .spyOn(sync as any, 'readPublishedOperationResult')
      .mockResolvedValue({ revision, run, noOp: false });
    jest
      .spyOn(publication, 'serializeRevision')
      .mockReturnValue({ id: revision.id } as any);
    jest
      .spyOn(publication, 'serializeSyncRun')
      .mockReturnValue({ id: run.id } as any);

    await expect(
      sync.publish(
        sourcePageId,
        { draftHash: 'a'.repeat(64) },
        'publish-replay',
        user,
      ),
    ).resolves.toEqual({
      revision: { id: revision.id },
      syncRun: { id: run.id },
      idempotent: true,
      noOp: false,
    });
    expect(getLiveContent).not.toHaveBeenCalled();
    expect(requireManaged).toHaveBeenCalledWith(sourcePageId, user);
  });

  it('does not replay completed publication metadata after access is revoked', async () => {
    const denied = new ForbiddenException('Template access revoked');
    const { sync, operations } = buildService();
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockRejectedValue(denied);
    const findCompleted = jest.spyOn(operations, 'findCompletedOperation');
    const readResult = jest.spyOn(sync as any, 'readPublishedOperationResult');

    await expect(
      sync.publish(
        sourcePageId,
        { draftHash: 'a'.repeat(64) },
        'publish-replay-revoked',
        user,
      ),
    ).rejects.toBe(denied);
    expect(findCompleted).not.toHaveBeenCalled();
    expect(readResult).not.toHaveBeenCalled();
  });

  it('fences publication when the live draft changes after the operation starts', async () => {
    const initialDraft = { type: 'doc', content: [{ type: 'paragraph' }] };
    const changedDraft = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'changed' }] },
      ],
    };
    const template = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      templateKind: 'synced',
      templateArchivedAt: null,
    };
    const db = {
      transaction: () => ({
        execute: (callback: (value: unknown) => Promise<unknown>) =>
          callback({}),
      }),
    };
    const { sync, content, operations, publication } = buildService({
      db,
      pageRepo: { findById: jest.fn().mockResolvedValue(template) },
    });
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue(template);
    jest
      .spyOn(content, 'getLiveContent')
      .mockResolvedValueOnce(initialDraft)
      .mockResolvedValueOnce(changedDraft);
    jest
      .spyOn(publication, 'normalizeDraftForPublication')
      .mockImplementation((value) => value as any);
    jest
      .spyOn(operations, 'findCompletedOperation')
      .mockResolvedValue(undefined);
    jest.spyOn(operations, 'beginOperation').mockResolvedValue({
      id: 'operation',
      status: 'pending',
      leaseToken: 'lease',
    });
    jest.spyOn(operations, 'failOperation').mockResolvedValue(undefined);
    jest
      .spyOn(sync as any, 'findLatestPublishedResult')
      .mockResolvedValue(null);
    jest.spyOn(sync as any, 'buildPublishPreflight').mockResolvedValue({
      requiresDestructiveConfirmation: false,
    });

    await expect(
      sync.publish(
        sourcePageId,
        { draftHash: hashProseMirrorJson(initialDraft as any) },
        'publish-fence',
        user,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_template_draft_changed',
      }),
    });
    expect(operations.failOperation).toHaveBeenCalledWith(
      'operation',
      'page_template_draft_changed',
      'lease',
    );
  });

  it('rejects an R1 destructive confirmation after R2 is published even when the live draft returns to the same hash', async () => {
    const fieldId = '019fdaa0-0000-7000-8000-000000000090';
    const destructiveDraft = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
    const revisionOneContent = {
      type: 'doc',
      content: [
        {
          type: 'templateField',
          attrs: { fieldId, label: 'Owner', placeholder: 'Assign owner' },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    const revisionTwoContent = {
      type: 'doc',
      content: [
        {
          type: 'templateField',
          attrs: { fieldId, label: 'Assignee', placeholder: 'Assign user' },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    const revisionOne = {
      id: '019fdaa0-0000-7000-8000-000000000091',
      revision: 1,
      content: revisionOneContent,
      contentHash: hashProseMirrorJson(revisionOneContent as any),
    };
    const revisionTwo = {
      id: '019fdaa0-0000-7000-8000-000000000092',
      revision: 2,
      content: revisionTwoContent,
      contentHash: hashProseMirrorJson(revisionTwoContent as any),
    };
    const confirmationToken = '019fdaa0-0000-7000-8000-000000000093';
    let latestRevision: any = revisionOne;
    let liveTemplateDraft: any = destructiveDraft;
    let confirmationValues: Record<string, any> | undefined;
    let confirmationQuery: any;

    const selectQuery = (table: string) => {
      const query: any = {};
      for (const method of [
        'select',
        'selectAll',
        'innerJoin',
        'where',
        'orderBy',
        'forUpdate',
        'limit',
      ]) {
        query[method] = jest.fn(() => query);
      }
      if (table === 'pageTemplatePublishConfirmations') {
        confirmationQuery = query;
      }
      query.executeTakeFirst = jest.fn(async () => {
        if (table === 'pageTemplateRevisions') return latestRevision;
        if (table === 'pageTemplatePublishConfirmations') {
          return confirmationValues
            ? { id: confirmationToken, ...confirmationValues }
            : undefined;
        }
        if (table === 'pageTemplateInstances as instance') {
          return { count: 1 };
        }
        return undefined;
      });
      query.execute = jest.fn(async () =>
        table === 'pageTemplateInstances as instance'
          ? [
              {
                id: 'instance-1',
                childPageId: consumerPageId,
                content: latestRevision.content,
              },
            ]
          : [],
      );
      return query;
    };
    const insertInto = jest.fn((table: string) => {
      const query: any = {};
      query.values = jest.fn((values: Record<string, any>) => {
        if (table === 'pageTemplatePublishConfirmations') {
          confirmationValues = values;
        }
        return query;
      });
      query.returning = jest.fn(() => query);
      query.returningAll = jest.fn(() => query);
      query.executeTakeFirstOrThrow = jest.fn(async () => {
        if (table === 'pageTemplatePublishConfirmations') {
          return { id: confirmationToken };
        }
        throw new Error(`Unexpected insert into ${table}`);
      });
      query.execute = jest.fn().mockResolvedValue(undefined);
      return query;
    });
    const trx = {
      selectFrom: jest.fn((table: string) => selectQuery(table)),
      insertInto,
      updateTable: jest.fn(),
    };
    const db = {
      selectFrom: jest.fn((table: string) => selectQuery(table)),
      insertInto,
      transaction: () => ({
        execute: (callback: (value: any) => Promise<unknown>) => callback(trx),
      }),
    };
    const template = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      templateKind: 'synced',
      templateArchivedAt: null,
      updatedAt: new Date('2026-08-14T12:00:00.000Z'),
    };
    const { sync, content, operations, publication } = buildService({
      db,
      pageRepo: { findById: jest.fn().mockResolvedValue(template) },
    });
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue(template);
    jest
      .spyOn(content, 'getLiveContent')
      .mockImplementation(async (pageId) =>
        pageId === sourcePageId ? liveTemplateDraft : latestRevision.content,
      );
    jest
      .spyOn(operations, 'findCompletedOperation')
      .mockResolvedValue(undefined);
    jest.spyOn(operations, 'beginOperation').mockResolvedValue({
      id: 'operation',
      status: 'pending',
      leaseToken: 'lease',
    });
    jest.spyOn(operations, 'failOperation').mockResolvedValue(undefined);
    jest
      .spyOn(sync as any, 'findLatestPublishedResult')
      .mockResolvedValue(null);

    const preview = await sync.preflightPublish(sourcePageId, user);
    expect(preview.confirmationToken).toBe(confirmationToken);
    expect(confirmationValues?.removedFieldIds).toEqual({
      version: 1,
      latestRevisionId: revisionOne.id,
      latestRevision: 1,
      latestContentHash: revisionOne.contentHash,
      removedFieldIds: [fieldId],
    });
    expect(
      publication.isConfirmationBasisValid(
        [fieldId],
        revisionOne,
        destructiveDraft,
      ),
    ).toBe(false);

    liveTemplateDraft = revisionTwoContent;
    latestRevision = revisionTwo;
    liveTemplateDraft = destructiveDraft;
    await expect(
      sync.publish(
        sourcePageId,
        {
          draftHash: preview.draftHash,
          confirmationToken: preview.confirmationToken!,
        },
        'publish-stale-confirmation',
        user,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_template_confirmation_invalid',
      }),
    });
    expect(insertInto).not.toHaveBeenCalledWith('pageTemplateRevisions');
    expect(trx.updateTable).not.toHaveBeenCalled();
    expect(confirmationQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(operations.failOperation).toHaveBeenCalledWith(
      'operation',
      'page_template_confirmation_invalid',
      'lease',
    );
  });

  it('creates an independent copy without template wrappers or linkage', async () => {
    const wrappedContent = {
      type: 'doc',
      content: [
        {
          type: 'templateManagedBlock',
          attrs: { templateBlockId: 'block', locked: true },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    const source = {
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      parentPageId: sourcePageId,
      title: 'Linked page',
      icon: null,
      deletedAt: null,
    };
    const createdPage = {
      ...source,
      id: '019fdaa0-0000-7000-8000-000000000099',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    };
    const instanceQuery: any = {};
    for (const method of ['selectAll', 'where']) {
      instanceQuery[method] = jest.fn(() => instanceQuery);
    }
    instanceQuery.executeTakeFirst = jest.fn().mockResolvedValue({
      id: 'instance',
      instanceKind: 'synced',
      status: 'active',
    });
    const lockedInstanceQuery: any = {};
    for (const method of ['select', 'where', 'forUpdate']) {
      lockedInstanceQuery[method] = jest.fn(() => lockedInstanceQuery);
    }
    lockedInstanceQuery.executeTakeFirst = jest
      .fn()
      .mockResolvedValue({ id: 'instance' });
    const trx = { selectFrom: jest.fn(() => lockedInstanceQuery) };
    const db = {
      selectFrom: jest.fn(() => instanceQuery),
      transaction: () => ({
        execute: (callback: (value: unknown) => Promise<unknown>) =>
          callback(trx),
      }),
    };
    const pageRepo = {
      findById: jest.fn(async (id: string, options?: unknown) =>
        id === source.id && options ? source : undefined,
      ),
    };
    const pageService = {
      create: jest.fn().mockResolvedValue(createdPage),
      finalizeCreatedPage: jest.fn().mockResolvedValue(undefined),
    };
    const pageAccessService = {
      assertCanReadPage: jest.fn().mockResolvedValue(undefined),
    };
    const transclusion = {
      insertTransclusionsForPages: jest.fn().mockResolvedValue(undefined),
      insertReferencesForPages: jest.fn().mockResolvedValue(undefined),
    };
    const { instance, content, operations } = buildService({
      db,
      pageRepo,
      pageService,
      pageAccessService,
      transclusion,
    });
    jest
      .spyOn(content, 'requirePlainDocument')
      .mockResolvedValue(source as any);
    jest.spyOn(content, 'assertCanCreate').mockResolvedValue(undefined);
    jest.spyOn(content, 'getLiveContent').mockResolvedValue(wrappedContent);
    jest.spyOn(content, 'copyAttachments').mockResolvedValue([]);
    jest
      .spyOn(operations, 'findCompletedOperation')
      .mockResolvedValue(undefined);
    jest.spyOn(operations, 'beginOperation').mockResolvedValue({
      id: 'operation',
      status: 'pending',
      resultPageId: createdPage.id,
      leaseToken: 'lease',
      stagedContent: null,
      attachmentMapping: null,
    });
    const stage = jest
      .spyOn(operations, 'stageAttachmentRewrittenContent')
      .mockImplementation(async (_id, _lease, liveSource) => ({
        content: liveSource,
        copies: [],
      }));
    jest.spyOn(operations, 'assertOperationLease').mockResolvedValue(undefined);
    jest
      .spyOn(operations, 'completeOperationInTransaction')
      .mockResolvedValue(undefined);
    jest
      .spyOn(operations, 'claimCreatedPageFinalization')
      .mockResolvedValue('finalization-lease');
    jest
      .spyOn(operations, 'completeCreatedPageFinalization')
      .mockResolvedValue(true);
    jest
      .spyOn(operations, 'releaseCreatedPageFinalization')
      .mockResolvedValue(undefined);
    jest.spyOn(operations, 'ownsOperationLease').mockResolvedValue(false);

    await expect(
      instance.createIndependentCopy(
        consumerPageId,
        {},
        'independent-key',
        user,
      ),
    ).resolves.toEqual({ page: createdPage, idempotent: false });
    expect(stage.mock.calls[0][2]).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
    expect(pageService.create).toHaveBeenCalledWith(
      user.id,
      user.workspaceId,
      expect.objectContaining({
        parentPageId: sourcePageId,
        spaceId: sourceSpaceId,
      }),
      expect.objectContaining({ templateKind: null }),
    );
    expect(db.selectFrom).toHaveBeenCalledTimes(1);
  });

  it('fences every page-creation flow on operation ownership inside its transaction', async () => {
    const leaseLost = () =>
      new ConflictException({
        code: 'page_template_operation_lease_lost',
        message: 'The page template operation lease was lost',
      });
    const stagedContent = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
    const source = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      parentPageId: null,
      title: 'Source',
      icon: null,
      templateKind: 'regular',
      templateArchivedAt: null,
      deletedAt: null,
    };

    const templateTrx = {};
    const templatePageService = {
      create: jest.fn(),
      finalizeCreatedPage: jest.fn(),
    };
    const template = buildService({
      db: {
        transaction: () => ({
          execute: (callback: (trx: unknown) => Promise<unknown>) =>
            callback(templateTrx),
        }),
      },
      pageRepo: { findById: jest.fn().mockResolvedValue(undefined) },
      pageService: templatePageService,
      transclusion: {
        insertTransclusionsForPages: jest.fn(),
        insertReferencesForPages: jest.fn(),
      },
    });
    jest
      .spyOn(template.operations, 'findCompletedOperation')
      .mockResolvedValue(null);
    jest
      .spyOn(template.content, 'assertCanCreate')
      .mockResolvedValue(undefined);
    jest.spyOn(template.operations, 'beginOperation').mockResolvedValue({
      id: 'create-template-operation',
      status: 'pending',
      resultPageId: consumerPageId,
      leaseToken: 'old-template-lease',
      stagedContent,
      attachmentMapping: [],
    } as any);
    const templateFence = jest
      .spyOn(template.operations, 'completeOperationInTransaction')
      .mockRejectedValue(leaseLost());
    jest
      .spyOn(template.operations, 'ownsOperationLease')
      .mockResolvedValue(false);

    await expect(
      template.instance.createTemplate(
        { spaceId: sourceSpaceId, kind: 'regular' },
        'lease-race-template',
        user,
      ),
    ).rejects.toMatchObject({
      response: { code: 'page_template_operation_lease_lost' },
    });
    expect(templateFence).toHaveBeenCalledWith(
      templateTrx,
      'create-template-operation',
      'old-template-lease',
      expect.any(Object),
    );
    expect(templatePageService.create).not.toHaveBeenCalled();

    const snapshotTrx = {};
    const snapshotPageService = {
      create: jest.fn(),
      finalizeCreatedPage: jest.fn(),
    };
    const snapshot = buildService({
      db: {
        transaction: () => ({
          execute: (callback: (trx: unknown) => Promise<unknown>) =>
            callback(snapshotTrx),
        }),
      },
      pageRepo: {
        findById: jest.fn(async (id: string, options?: unknown) =>
          id === sourcePageId && options ? source : undefined,
        ),
      },
      pageService: snapshotPageService,
    });
    jest
      .spyOn(snapshot.operations, 'findCompletedOperation')
      .mockResolvedValue(null);
    jest
      .spyOn(snapshot.content, 'requireTemplateSource')
      .mockResolvedValue(source as any);
    jest
      .spyOn(snapshot.content, 'assertCanCreate')
      .mockResolvedValue(undefined);
    jest.spyOn(snapshot.content, 'copyAttachments').mockResolvedValue([]);
    jest.spyOn(snapshot.operations, 'beginOperation').mockResolvedValue({
      id: 'create-snapshot-operation',
      status: 'pending',
      resultPageId: consumerPageId,
      leaseToken: 'old-snapshot-lease',
      stagedContent,
      attachmentMapping: [],
    } as any);
    const snapshotFence = jest
      .spyOn(snapshot.operations, 'completeOperationInTransaction')
      .mockRejectedValue(leaseLost());
    jest
      .spyOn(snapshot.operations, 'assertOperationLease')
      .mockResolvedValue(undefined);
    jest
      .spyOn(snapshot.operations, 'ownsOperationLease')
      .mockResolvedValue(false);

    await expect(
      snapshot.instance.createFromTemplate(
        { templatePageId: sourcePageId, spaceId: sourceSpaceId },
        'lease-race-snapshot',
        user,
      ),
    ).rejects.toMatchObject({
      response: { code: 'page_template_operation_lease_lost' },
    });
    expect(snapshotFence).toHaveBeenCalledWith(
      snapshotTrx,
      'create-snapshot-operation',
      'old-snapshot-lease',
      expect.any(Object),
    );
    expect(snapshotPageService.create).not.toHaveBeenCalled();

    const linkedInstance = { id: 'linked-instance', status: 'active' };
    const linkedQuery: any = {};
    for (const method of ['selectAll', 'where']) {
      linkedQuery[method] = jest.fn(() => linkedQuery);
    }
    linkedQuery.executeTakeFirst = jest.fn().mockResolvedValue(linkedInstance);
    const lockedInstanceQuery: any = {};
    for (const method of ['select', 'where', 'forUpdate']) {
      lockedInstanceQuery[method] = jest.fn(() => lockedInstanceQuery);
    }
    lockedInstanceQuery.executeTakeFirst = jest
      .fn()
      .mockResolvedValue(linkedInstance);
    const copyTrx = { selectFrom: jest.fn(() => lockedInstanceQuery) };
    const copyPageService = {
      create: jest.fn(),
      finalizeCreatedPage: jest.fn(),
    };
    const independent = buildService({
      db: {
        selectFrom: jest.fn(() => linkedQuery),
        transaction: () => ({
          execute: (callback: (trx: unknown) => Promise<unknown>) =>
            callback(copyTrx),
        }),
      },
      pageRepo: {
        findById: jest.fn(async (id: string, options?: unknown) =>
          id === sourcePageId && options ? source : undefined,
        ),
      },
      pageService: copyPageService,
      pageAccessService: {
        assertCanReadPage: jest.fn().mockResolvedValue(undefined),
      },
    });
    jest
      .spyOn(independent.operations, 'findCompletedOperation')
      .mockResolvedValue(null);
    jest
      .spyOn(independent.content, 'requirePlainDocument')
      .mockResolvedValue({ ...source, templateKind: null } as any);
    jest
      .spyOn(independent.content, 'assertCanCreate')
      .mockResolvedValue(undefined);
    jest.spyOn(independent.content, 'copyAttachments').mockResolvedValue([]);
    jest.spyOn(independent.operations, 'beginOperation').mockResolvedValue({
      id: 'independent-copy-operation',
      status: 'pending',
      resultPageId: consumerPageId,
      leaseToken: 'old-copy-lease',
      stagedContent,
      attachmentMapping: [],
    } as any);
    const copyFence = jest
      .spyOn(independent.operations, 'completeOperationInTransaction')
      .mockRejectedValue(leaseLost());
    jest
      .spyOn(independent.operations, 'assertOperationLease')
      .mockResolvedValue(undefined);
    jest
      .spyOn(independent.operations, 'ownsOperationLease')
      .mockResolvedValue(false);

    await expect(
      independent.instance.createIndependentCopy(
        sourcePageId,
        {},
        'lease-race-copy',
        user,
      ),
    ).rejects.toMatchObject({
      response: { code: 'page_template_operation_lease_lost' },
    });
    expect(copyFence).toHaveBeenCalledWith(
      copyTrx,
      'independent-copy-operation',
      'old-copy-lease',
      expect.any(Object),
    );
    expect(copyPageService.create).not.toHaveBeenCalled();
  });

  it('fails closed when collaboration content cannot be loaded', async () => {
    const collaborationFailure = new Error('collaboration unavailable');
    const collaboration = {
      getPageContent: jest.fn(async () => {
        throw collaborationFailure;
      }),
    };
    const { content } = buildService({ collaboration });

    await expect(content.getLiveContent(sourcePageId, user)).rejects.toBe(
      collaborationFailure,
    );
    expect(collaboration.getPageContent).toHaveBeenCalledWith(
      `page.${sourcePageId}`,
      { user },
    );
  });

  it('preserves copied paths when a later attachment copy fails', async () => {
    const firstAttachmentId = '019fdaa0-0000-7000-8000-000000000071';
    const secondAttachmentId = '019fdaa0-0000-7000-8000-000000000072';
    const firstTargetId = '019fdaa0-0000-7000-8000-000000000073';
    const secondTargetId = '019fdaa0-0000-7000-8000-000000000074';
    const copyFailure = new Error('copy failed');
    const attachmentRepo = {
      findByIds: jest.fn(async () => [
        {
          id: firstAttachmentId,
          pageId: sourcePageId,
          filePath: `pages/${firstAttachmentId}/first.pdf`,
        },
        {
          id: secondAttachmentId,
          pageId: sourcePageId,
          filePath: `pages/${secondAttachmentId}/second.pdf`,
        },
      ]),
    };
    const storageService = {
      copy: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(copyFailure),
    };
    const { content } = buildService({ attachmentRepo, storageService });
    const copiedPaths: string[] = [];

    await expect(
      content.copyAttachments(
        [
          {
            oldAttachmentId: firstAttachmentId,
            newAttachmentId: firstTargetId,
          },
          {
            oldAttachmentId: secondAttachmentId,
            newAttachmentId: secondTargetId,
          },
        ],
        { id: sourcePageId } as any,
        consumerPageId,
        targetSpaceId,
        user,
        copiedPaths,
        false,
      ),
    ).rejects.toBe(copyFailure);
    expect(copiedPaths).toEqual([`pages/${firstTargetId}/first.pdf`]);
  });

  it('rejects a lost operation lease with the stable conflict code', async () => {
    const query: any = {};
    for (const method of ['select', 'where']) {
      query[method] = jest.fn(() => query);
    }
    query.executeTakeFirst = jest.fn(async () => undefined);
    const { operations } = buildService({
      db: { selectFrom: jest.fn(() => query) },
    });

    await expect(
      operations.assertOperationLease('operation-1', 'lost-lease'),
    ).rejects.toMatchObject({
      response: { code: 'page_template_operation_lease_lost' },
    });
  });

  it('keeps stable error codes and redacts raw failure messages', () => {
    const { operations } = buildService();

    expect(
      operations.errorCode(
        new ConflictException({
          code: 'page_template_sync_conflict',
          message: 'The template changed',
        }),
      ),
    ).toBe('page_template_sync_conflict');
    expect(
      operations.errorCode(
        new Error('storage failed for /private/G24_CANARY_SECRET/customer.pdf'),
      ),
    ).toBe('page_template_operation_failed');
    expect(
      operations.errorCode(new Error('duplicate_attachments_partial_failure')),
    ).toBe('page_template_operation_failed');
  });

  it('treats an older sync item as completed when a newer revision wins the persistence race', async () => {
    const query: any = {
      selectAll: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue({
        id: 'instance-1',
        templatePageId: sourcePageId,
        appliedRevision: 0,
        status: 'active',
      }),
    };
    const updateQuery: any = {
      set: jest.fn(() => updateQuery),
      where: jest.fn(() => updateQuery),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const db = {
      selectFrom: jest.fn(() => query),
      updateTable: jest.fn(() => updateQuery),
    };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue({
        id: consumerPageId,
        deletedAt: null,
      }),
    };
    const { sync, content, operations } = buildService({ db, pageRepo });
    const current = {
      type: 'doc',
      content: [
        {
          type: 'templateManagedBlock',
          attrs: { templateBlockId: 'block-1', locked: true },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    jest
      .spyOn(sync as any, 'prepareInstanceRevisionContent')
      .mockResolvedValue(current);
    jest.spyOn(content, 'getLiveContent').mockResolvedValue({
      ...current,
      content: [
        {
          ...current.content[0],
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'old' }],
            },
          ],
        },
      ],
    });
    jest.spyOn(operations, 'beginOperation').mockResolvedValue({
      id: 'operation-1',
      leaseToken: 'lease-1',
    });
    jest.spyOn(operations, 'ownsOperationLease').mockResolvedValue(true);
    const failOperation = jest
      .spyOn(operations, 'failOperation')
      .mockResolvedValue(undefined);
    jest.spyOn(content, 'applyMutation').mockRejectedValue(
      new ConflictException({
        code: 'page_template_revision_stale',
        message: 'A newer revision won',
      }),
    );
    const completed = jest
      .spyOn(sync as any, 'markSyncItemCompleted')
      .mockResolvedValue(undefined);
    const failed = jest
      .spyOn(sync as any, 'markSyncItemFailed')
      .mockResolvedValue(undefined);

    await sync.processSyncItem(
      { id: 'run-1', templatePageId: sourcePageId, revision: 1 },
      { content: current },
      {
        id: 'item-1',
        instanceId: 'instance-1',
        childPageId: consumerPageId,
        attemptCount: 0,
      },
      user,
    );

    expect(completed).toHaveBeenCalledWith('item-1');
    expect(failed).not.toHaveBeenCalled();
    expect(failOperation).toHaveBeenCalledWith(
      'operation-1',
      'page_template_revision_stale',
      'lease-1',
    );
  });

  it('fails an abandoned sync operation so the same item can retry immediately', async () => {
    const query: any = {
      selectAll: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue({
        id: 'instance-1',
        templatePageId: sourcePageId,
        appliedRevision: 0,
        status: 'active',
      }),
    };
    const updateQuery: any = {
      set: jest.fn(() => updateQuery),
      where: jest.fn(() => updateQuery),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const db = {
      selectFrom: jest.fn(() => query),
      updateTable: jest.fn(() => updateQuery),
    };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue({
        id: consumerPageId,
        deletedAt: null,
      }),
    };
    const { sync, content, operations } = buildService({ db, pageRepo });
    const current = {
      type: 'doc',
      content: [
        {
          type: 'templateManagedBlock',
          attrs: { templateBlockId: 'block-1', locked: true },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    jest
      .spyOn(sync as any, 'prepareInstanceRevisionContent')
      .mockResolvedValue(current);
    jest.spyOn(content, 'getLiveContent').mockResolvedValue({
      ...current,
      content: [
        {
          ...current.content[0],
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'old' }],
            },
          ],
        },
      ],
    });
    let operationPending = false;
    const beginOperation = jest
      .spyOn(operations, 'beginOperation')
      .mockImplementation(async () => {
        if (operationPending) {
          throw new ConflictException({
            code: 'page_template_operation_in_progress',
          });
        }
        operationPending = true;
        return { id: 'operation-1', leaseToken: 'lease-1' } as any;
      });
    jest.spyOn(operations, 'ownsOperationLease').mockResolvedValue(true);
    const failOperation = jest
      .spyOn(operations, 'failOperation')
      .mockImplementation(async () => {
        operationPending = false;
      });
    jest
      .spyOn(content, 'applyMutation')
      .mockRejectedValue(new Error('transient collaboration failure'));
    jest.spyOn(sync as any, 'markSyncItemFailed').mockResolvedValue(undefined);
    const run = { id: 'run-1', templatePageId: sourcePageId, revision: 1 };
    const revision = { content: current };
    const item = {
      id: 'item-1',
      instanceId: 'instance-1',
      childPageId: consumerPageId,
      attemptCount: 0,
    };

    await sync.processSyncItem(run, revision, item, user);
    await sync.processSyncItem(run, revision, item, user);

    expect(beginOperation).toHaveBeenCalledTimes(2);
    expect(failOperation).toHaveBeenCalledTimes(2);
    expect(operationPending).toBe(false);
  });

  it('uses a new operation generation after a sync run lease is recovered', async () => {
    const query: any = {
      selectAll: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue({
        id: 'instance-1',
        templatePageId: sourcePageId,
        appliedRevision: 0,
        status: 'syncing',
      }),
    };
    const updateQuery: any = {
      set: jest.fn(() => updateQuery),
      where: jest.fn(() => updateQuery),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const db = {
      selectFrom: jest.fn(() => query),
      updateTable: jest.fn(() => updateQuery),
    };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue({
        id: consumerPageId,
        deletedAt: null,
      }),
    };
    const { sync, content, operations } = buildService({ db, pageRepo });
    const published = {
      type: 'doc',
      content: [
        {
          type: 'templateManagedBlock',
          attrs: { templateBlockId: 'block-1', locked: true },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    const current = {
      ...published,
      content: [
        {
          ...published.content[0],
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'old' }],
            },
          ],
        },
      ],
    };
    jest
      .spyOn(sync as any, 'prepareInstanceRevisionContent')
      .mockResolvedValue(published);
    jest.spyOn(content, 'getLiveContent').mockResolvedValue(current);
    const pendingKeys = new Set<string>();
    const operationKeys: string[] = [];
    jest
      .spyOn(operations, 'beginOperation')
      .mockImplementation(async (_kind, key) => {
        operationKeys.push(key);
        if (pendingKeys.has(key)) {
          throw new ConflictException({
            code: 'page_template_operation_in_progress',
          });
        }
        pendingKeys.add(key);
        return {
          id: `operation-${operationKeys.length}`,
          leaseToken: `operation-lease-${operationKeys.length}`,
        } as any;
      });
    jest.spyOn(operations, 'ownsOperationLease').mockResolvedValue(false);
    jest
      .spyOn(content, 'applyMutation')
      .mockRejectedValueOnce(new Error('worker crashed after operation claim'))
      .mockResolvedValueOnce(undefined);
    const completed = jest
      .spyOn(sync as any, 'markSyncItemCompleted')
      .mockResolvedValue(undefined);
    jest.spyOn(sync as any, 'markSyncItemFailed').mockResolvedValue(undefined);
    const revision = { content: published };
    const item = {
      id: 'item-1',
      instanceId: 'instance-1',
      childPageId: consumerPageId,
      attemptCount: 0,
    };

    await sync.processSyncItem(
      {
        id: 'run-1',
        leaseToken: 'run-lease-before-crash',
        templatePageId: sourcePageId,
        revision: 1,
      },
      revision,
      item,
      user,
    );
    await sync.processSyncItem(
      {
        id: 'run-1',
        leaseToken: 'run-lease-after-recovery',
        templatePageId: sourcePageId,
        revision: 1,
      },
      revision,
      item,
      user,
    );

    expect(operationKeys).toEqual([
      'template-sync:run-1:instance-1:run-lease-before-crash:1',
      'template-sync:run-1:instance-1:run-lease-after-recovery:1',
    ]);
    expect(content.applyMutation).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledWith('item-1');
  });

  it('keeps revision pagination stable when a newer revision is inserted between pages', async () => {
    const revisionRows = [3, 2, 1].map((revision) => ({
      id: `019fdaa0-0000-7000-8000-00000000009${revision}`,
      templatePageId: sourcePageId,
      revision,
      contentHash: `hash-${revision}`,
      content: { type: 'doc', content: [] },
      publishedById: user.id,
      createdAt: new Date(`2026-08-14T12:0${revision}:00.000Z`),
    }));
    const makeRevisionQuery = () => {
      const predicates: Array<(eb: any) => boolean> = [];
      let queryLimit = Number.POSITIVE_INFINITY;
      const query: any = {};
      query.selectAll = jest.fn(() => query);
      query.where = jest.fn((value: unknown) => {
        if (typeof value === 'function') {
          predicates.push(value as (eb: any) => boolean);
        }
        return query;
      });
      query.orderBy = jest.fn(() => query);
      query.limit = jest.fn((value: number) => {
        queryLimit = value;
        return query;
      });
      query.execute = jest.fn(async () => {
        const evaluate = (row: any, predicate: (eb: any) => boolean) => {
          const eb: any = (field: string, operator: string, value: unknown) => {
            const left = row[field];
            if (operator === '<') return left < value;
            if (operator === '=') return left === value;
            throw new Error(`Unsupported operator ${operator}`);
          };
          eb.or = (values: boolean[]) => values.some(Boolean);
          eb.and = (values: boolean[]) => values.every(Boolean);
          return predicate(eb);
        };
        return revisionRows
          .filter((row) =>
            predicates.every((predicate) => evaluate(row, predicate)),
          )
          .sort(
            (left, right) =>
              right.revision - left.revision || right.id.localeCompare(left.id),
          )
          .slice(0, queryLimit);
      });
      return query;
    };
    const { sync } = buildService({
      db: { selectFrom: jest.fn(() => makeRevisionQuery()) },
    });
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue({ id: sourcePageId });

    const first = await sync.listRevisions(sourcePageId, { limit: 2 }, user);
    expect(first.items.map((item) => item.revision)).toEqual([3, 2]);
    expect(first.nextCursor).toEqual(expect.any(String));
    revisionRows.unshift({
      id: '019fdaa0-0000-7000-8000-000000000094',
      templatePageId: sourcePageId,
      revision: 4,
      contentHash: 'hash-4',
      content: { type: 'doc', content: [] },
      publishedById: user.id,
      createdAt: new Date('2026-08-14T12:04:00.000Z'),
    });

    const second = await sync.listRevisions(
      sourcePageId,
      { limit: 2, cursor: first.nextCursor! },
      user,
    );
    expect(second.items.map((item) => item.revision)).toEqual([1]);
    expect(second.nextCursor).toBeNull();
  });

  it('persists a retry dispatch in the run transaction before signaling the queue', async () => {
    const runId = '019fdaa0-0000-7000-8000-000000000099';
    const runQuery: Record<string, jest.Mock> = {};
    for (const method of ['selectAll', 'where', 'forUpdate']) {
      runQuery[method] = jest.fn(() => runQuery);
    }
    runQuery.executeTakeFirst = jest.fn().mockResolvedValue({
      id: runId,
      templatePageId: sourcePageId,
      status: 'partial',
      failedCount: 1,
      succeededCount: 2,
    });
    const itemCountsQuery: Record<string, jest.Mock> = {};
    for (const method of ['select', 'where', 'groupBy']) {
      itemCountsQuery[method] = jest.fn(() => itemCountsQuery);
    }
    itemCountsQuery.execute = jest.fn().mockResolvedValue([
      { status: 'completed', count: 2 },
      { status: 'failed', count: 1 },
    ]);
    const retryItemsQuery: any = {};
    for (const method of ['select', 'where']) {
      retryItemsQuery[method] = jest.fn(() => retryItemsQuery);
    }
    const updates: Array<{ table: string; values: Record<string, unknown> }> =
      [];
    const updateQuery = (table: string) => {
      const query: Record<string, jest.Mock> = {};
      query.set = jest.fn((values: Record<string, unknown>) => {
        updates.push({ table, values });
        return query;
      });
      query.where = jest.fn(() => query);
      query.returning = jest.fn(() => query);
      query.execute = jest.fn().mockResolvedValue(undefined);
      query.executeTakeFirst = jest.fn().mockResolvedValue({ id: runId });
      return query;
    };
    const selectQueries = [runQuery, itemCountsQuery, retryItemsQuery];
    const trx = {
      selectFrom: jest.fn(() => selectQueries.shift()),
      updateTable: jest.fn((table: string) => updateQuery(table)),
    };
    let transactionCommitted = false;
    const db = {
      transaction: () => ({
        execute: async (callback: (trx: any) => Promise<unknown>) => {
          const result = await callback(trx);
          transactionCommitted = true;
          return result;
        },
      }),
    };
    const queueOutbox = {
      enqueuePageTemplateSync: jest.fn(async (_payload, _dispatchId, tx) => {
        expect(tx).toBe(trx);
        expect(transactionCommitted).toBe(false);
      }),
      kick: jest.fn(() => expect(transactionCommitted).toBe(true)),
    };
    const { sync } = buildService({ db, queueOutbox });
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue({ id: sourcePageId });

    await expect(sync.retrySyncRun(sourcePageId, runId, user)).resolves.toEqual(
      { accepted: true, runId },
    );

    expect(queueOutbox.enqueuePageTemplateSync).toHaveBeenCalledWith(
      { runId },
      expect.any(String),
      trx,
    );
    expect(queueOutbox.kick).toHaveBeenCalledTimes(1);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'pageTemplateInstances',
          values: expect.objectContaining({
            status: 'syncing',
            lastErrorCode: null,
          }),
        }),
        expect.objectContaining({
          table: 'pageTemplateSyncItems',
          values: expect.objectContaining({
            status: 'pending',
            attemptCount: 0,
            errorCode: null,
          }),
        }),
        expect.objectContaining({
          table: 'pageTemplateSyncRuns',
          values: expect.objectContaining({
            status: 'pending',
            processedCount: 2,
            succeededCount: 2,
            failedCount: 0,
            startedAt: null,
            completedAt: null,
            leaseToken: null,
            leaseExpiresAt: null,
          }),
        }),
      ]),
    );
  });

  it('keeps a v2-applied instance active when retrying its failed v1 run', async () => {
    const runId = '019fdaa0-0000-7000-8000-000000000095';
    const instanceState = {
      id: 'instance-v2',
      templatePageId: sourcePageId,
      childPageId: consumerPageId,
      appliedRevision: 2,
      status: 'active',
      lastErrorCode: null,
    };
    const itemState = {
      id: 'item-v1',
      runId,
      instanceId: instanceState.id,
      childPageId: consumerPageId,
      status: 'failed',
      attemptCount: 1,
      errorCode: 'page_template_operation_failed',
    };
    const runState = {
      id: runId,
      templatePageId: sourcePageId,
      revision: 1,
      status: 'partial',
      failedCount: 1,
      succeededCount: 0,
    };
    let retryItemSelectCount = 0;
    const selectQuery = (result: unknown, many = false) => {
      const query: any = {};
      for (const method of [
        'select',
        'selectAll',
        'where',
        'groupBy',
        'forUpdate',
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.executeTakeFirst = jest.fn().mockImplementation(async () => result);
      query.execute = jest
        .fn()
        .mockImplementation(async () => (many ? result : []));
      return query;
    };
    const updateQuery = (table: string) => {
      const query: any = {};
      let values: Record<string, unknown> = {};
      let predicateAllowsUpdate = true;
      query.set = jest.fn((next: Record<string, unknown>) => {
        values = next;
        return query;
      });
      query.where = jest.fn((...args: unknown[]) => {
        if (typeof args[0] === 'function') {
          const eb: any = (
            field: keyof typeof instanceState,
            operator: string,
            value: unknown,
          ) => {
            const current = instanceState[field];
            if (operator === 'is' && value === null) return current === null;
            if (operator === '<') return Number(current) < Number(value);
            throw new Error(`Unsupported retry predicate ${operator}`);
          };
          eb.or = (conditions: boolean[]) => conditions.some(Boolean);
          predicateAllowsUpdate = Boolean(args[0](eb));
        }
        return query;
      });
      query.returning = jest.fn(() => query);
      query.execute = jest.fn(async () => {
        if (!predicateAllowsUpdate) return [];
        if (table === 'pageTemplateInstances') {
          Object.assign(instanceState, values);
        } else if (table === 'pageTemplateSyncItems') {
          Object.assign(itemState, values);
        } else if (table === 'pageTemplateSyncRuns') {
          Object.assign(runState, values);
        }
        return [];
      });
      query.executeTakeFirst = jest.fn(async () => {
        await query.execute();
        return table === 'pageTemplateSyncRuns' ? { id: runId } : undefined;
      });
      return query;
    };
    const trx = {
      selectFrom: jest.fn((table: string) => {
        if (table === 'pageTemplateSyncRuns') return selectQuery(runState);
        if (table === 'pageTemplateSyncItems') {
          retryItemSelectCount += 1;
          return retryItemSelectCount === 1
            ? selectQuery([{ status: itemState.status, count: 1 }], true)
            : selectQuery(undefined);
        }
        return selectQuery(undefined);
      }),
      updateTable: jest.fn((table: string) => updateQuery(table)),
    };
    const db = {
      transaction: () => ({
        execute: (callback: (transaction: any) => Promise<unknown>) =>
          callback(trx),
      }),
      selectFrom: jest.fn((table: string) =>
        table === 'pageTemplateInstances'
          ? selectQuery(instanceState)
          : selectQuery(undefined),
      ),
      updateTable: jest.fn((table: string) => updateQuery(table)),
    };
    const queueOutbox = {
      enqueuePageTemplateSync: jest.fn().mockResolvedValue(undefined),
      kick: jest.fn(),
    };
    const pageRepo = { findById: jest.fn() };
    const { sync } = buildService({ db, queueOutbox, pageRepo });
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue({ id: sourcePageId });

    await expect(sync.retrySyncRun(sourcePageId, runId, user)).resolves.toEqual(
      { accepted: true, runId },
    );
    expect(instanceState).toMatchObject({
      appliedRevision: 2,
      status: 'active',
      lastErrorCode: null,
    });
    expect(itemState.status).toBe('pending');

    await sync.processSyncItem(
      runState,
      { revision: 1, content: { type: 'doc', content: [] } },
      itemState,
      user,
    );

    expect(itemState.status).toBe('completed');
    expect(instanceState).toMatchObject({
      appliedRevision: 2,
      status: 'active',
      lastErrorCode: null,
    });
    expect(pageRepo.findById).not.toHaveBeenCalled();
  });

  it('recovers a terminal failed run with unfinished items even when failedCount is zero', async () => {
    const runId = '019fdaa0-0000-7000-8000-000000000096';
    const runQuery: any = {};
    for (const method of ['selectAll', 'where', 'forUpdate']) {
      runQuery[method] = jest.fn(() => runQuery);
    }
    runQuery.executeTakeFirst = jest.fn().mockResolvedValue({
      id: runId,
      templatePageId: sourcePageId,
      status: 'failed',
      totalCount: 2,
      processedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      errorCode: 'page_template_operation_failed',
    });
    const itemCountsQuery: any = {};
    for (const method of ['select', 'where', 'groupBy']) {
      itemCountsQuery[method] = jest.fn(() => itemCountsQuery);
    }
    itemCountsQuery.execute = jest.fn().mockResolvedValue([
      { status: 'pending', count: 1 },
      { status: 'running', count: 1 },
    ]);
    const retryItemsQuery: any = {};
    for (const method of ['select', 'where']) {
      retryItemsQuery[method] = jest.fn(() => retryItemsQuery);
    }
    const updates: Array<{ table: string; values: Record<string, unknown> }> =
      [];
    const updateQueries = new Map<string, any>();
    const updateQuery = (table: string) => {
      const query: any = {};
      query.set = jest.fn((values: Record<string, unknown>) => {
        updates.push({ table, values });
        return query;
      });
      query.where = jest.fn(() => query);
      query.returning = jest.fn(() => query);
      query.execute = jest.fn().mockResolvedValue(undefined);
      query.executeTakeFirst = jest.fn().mockResolvedValue({ id: runId });
      updateQueries.set(table, query);
      return query;
    };
    const selectQueries = [runQuery, itemCountsQuery, retryItemsQuery];
    const trx = {
      selectFrom: jest.fn(() => selectQueries.shift()),
      updateTable: jest.fn((table: string) => updateQuery(table)),
    };
    const completedCountsQuery: any = {};
    for (const method of ['select', 'where', 'groupBy']) {
      completedCountsQuery[method] = jest.fn(() => completedCountsQuery);
    }
    completedCountsQuery.execute = jest
      .fn()
      .mockResolvedValue([{ status: 'completed', count: 2 }]);
    const finalRunUpdate: any = {};
    finalRunUpdate.set = jest.fn(() => finalRunUpdate);
    finalRunUpdate.where = jest.fn(() => finalRunUpdate);
    finalRunUpdate.returning = jest.fn(() => finalRunUpdate);
    finalRunUpdate.executeTakeFirst = jest
      .fn()
      .mockResolvedValue({ id: runId });
    const db = {
      transaction: () => ({
        execute: (callback: (value: any) => Promise<unknown>) => callback(trx),
      }),
      selectFrom: jest.fn(() => completedCountsQuery),
      updateTable: jest.fn(() => finalRunUpdate),
    };
    const queueOutbox = {
      enqueuePageTemplateSync: jest.fn().mockResolvedValue(undefined),
      kick: jest.fn(),
    };
    const { sync } = buildService({ db, queueOutbox });
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue({ id: sourcePageId });

    await expect(sync.retrySyncRun(sourcePageId, runId, user)).resolves.toEqual(
      { accepted: true, runId },
    );
    expect(
      updateQueries.get('pageTemplateSyncItems').where,
    ).toHaveBeenCalledWith('status', 'in', ['pending', 'running', 'failed']);
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: 'pageTemplateSyncRuns',
        values: expect.objectContaining({
          status: 'pending',
          processedCount: 0,
          succeededCount: 0,
          failedCount: 0,
          errorCode: null,
        }),
      }),
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: 'pageTemplateInstances',
        values: expect.objectContaining({
          status: 'syncing',
          lastErrorCode: null,
        }),
      }),
    );
    expect(queueOutbox.enqueuePageTemplateSync).toHaveBeenCalledTimes(1);
    expect(queueOutbox.kick).toHaveBeenCalledTimes(1);

    await sync.recalculateSyncRun(runId, 'worker-lease');
    expect(finalRunUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        processedCount: 2,
        succeededCount: 2,
        failedCount: 0,
      }),
    );
  });

  it.each(['running', 'completed'])(
    'rejects retry for a %s synchronization run without changing queue state',
    async (status) => {
      const runId = '019fdaa0-0000-7000-8000-000000000098';
      const runQuery: any = {};
      for (const method of ['selectAll', 'where', 'forUpdate']) {
        runQuery[method] = jest.fn(() => runQuery);
      }
      runQuery.executeTakeFirst = jest.fn().mockResolvedValue({
        id: runId,
        templatePageId: sourcePageId,
        status,
        failedCount: 1,
      });
      const trx = {
        selectFrom: jest.fn(() => runQuery),
        updateTable: jest.fn(),
      };
      const db = {
        transaction: () => ({
          execute: (callback: (value: any) => Promise<unknown>) =>
            callback(trx),
        }),
      };
      const queueOutbox = {
        enqueuePageTemplateSync: jest.fn(),
        kick: jest.fn(),
      };
      const { sync } = buildService({ db, queueOutbox });
      jest
        .spyOn(sync as any, 'requireManagedSyncedTemplate')
        .mockResolvedValue({ id: sourcePageId });

      const retry = sync.retrySyncRun(sourcePageId, runId, user);
      await expect(retry).rejects.toMatchObject({
        response: {
          code: 'page_template_sync_retry_not_available',
        },
      });
      expect(trx.updateTable).not.toHaveBeenCalled();
      expect(queueOutbox.enqueuePageTemplateSync).not.toHaveBeenCalled();
      expect(queueOutbox.kick).not.toHaveBeenCalled();
    },
  );

  it('fences a concurrent retry status transition before enqueueing', async () => {
    const runId = '019fdaa0-0000-7000-8000-000000000097';
    const runQuery: any = {};
    for (const method of ['selectAll', 'where', 'forUpdate']) {
      runQuery[method] = jest.fn(() => runQuery);
    }
    runQuery.executeTakeFirst = jest.fn().mockResolvedValue({
      id: runId,
      templatePageId: sourcePageId,
      status: 'failed',
      failedCount: 1,
      succeededCount: 0,
    });
    const itemCountsQuery: any = {};
    for (const method of ['select', 'where', 'groupBy']) {
      itemCountsQuery[method] = jest.fn(() => itemCountsQuery);
    }
    itemCountsQuery.execute = jest
      .fn()
      .mockResolvedValue([{ status: 'failed', count: 1 }]);
    const retryItemsQuery: any = {};
    for (const method of ['select', 'where']) {
      retryItemsQuery[method] = jest.fn(() => retryItemsQuery);
    }
    const updateQuery = (table: string) => {
      const query: any = {};
      query.set = jest.fn(() => query);
      query.where = jest.fn(() => query);
      query.returning = jest.fn(() => query);
      query.execute = jest.fn().mockResolvedValue(undefined);
      query.executeTakeFirst = jest
        .fn()
        .mockResolvedValue(
          table === 'pageTemplateSyncRuns' ? undefined : { id: runId },
        );
      return query;
    };
    const selectQueries = [runQuery, itemCountsQuery, retryItemsQuery];
    const trx = {
      selectFrom: jest.fn(() => selectQueries.shift()),
      updateTable: jest.fn((table: string) => updateQuery(table)),
    };
    const db = {
      transaction: () => ({
        execute: (callback: (value: any) => Promise<unknown>) => callback(trx),
      }),
    };
    const queueOutbox = {
      enqueuePageTemplateSync: jest.fn(),
      kick: jest.fn(),
    };
    const { sync } = buildService({ db, queueOutbox });
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue({ id: sourcePageId });

    await expect(
      sync.retrySyncRun(sourcePageId, runId, user),
    ).rejects.toMatchObject({
      response: { code: 'page_template_sync_retry_not_available' },
    });
    expect(queueOutbox.enqueuePageTemplateSync).not.toHaveBeenCalled();
    expect(queueOutbox.kick).not.toHaveBeenCalled();
  });

  it('persists running sync aggregates without releasing the lease', async () => {
    const selectQuery: any = {};
    for (const method of ['select', 'where', 'groupBy']) {
      selectQuery[method] = jest.fn(() => selectQuery);
    }
    selectQuery.execute = jest.fn().mockResolvedValue([
      { status: 'completed', count: 3 },
      { status: 'failed', count: 1 },
      { status: 'pending', count: 2 },
    ]);
    const updateQuery: any = {};
    updateQuery.set = jest.fn(() => updateQuery);
    updateQuery.where = jest.fn(() => updateQuery);
    updateQuery.returning = jest.fn(() => updateQuery);
    updateQuery.executeTakeFirst = jest.fn().mockResolvedValue({ id: 'run-1' });
    const { sync } = buildService({
      db: {
        selectFrom: jest.fn(() => selectQuery),
        updateTable: jest.fn(() => updateQuery),
      },
    });

    await expect(sync.updateSyncRunProgress('run-1', 'lease-1')).resolves.toBe(
      true,
    );
    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        processedCount: 4,
        succeededCount: 3,
        failedCount: 1,
        errorCode: null,
        completedAt: null,
      }),
    );
    const values = updateQuery.set.mock.calls[0][0];
    expect(values).not.toHaveProperty('leaseToken');
    expect(values).not.toHaveProperty('leaseExpiresAt');
  });

  it('marks queued instances as error when a sync run fails globally', async () => {
    const runId = '019fdaa0-0000-7000-8000-000000000095';
    const itemQuery: any = {};
    for (const method of ['select', 'where']) {
      itemQuery[method] = jest.fn(() => itemQuery);
    }
    const updates: Array<{ table: string; values: Record<string, unknown> }> =
      [];
    const updateQuery = (table: string) => {
      const query: any = {};
      query.set = jest.fn((values: Record<string, unknown>) => {
        updates.push({ table, values });
        return query;
      });
      query.where = jest.fn(() => query);
      query.returning = jest.fn(() => query);
      query.executeTakeFirst = jest.fn().mockResolvedValue({ id: runId });
      query.execute = jest.fn().mockResolvedValue(undefined);
      return query;
    };
    const trx = {
      selectFrom: jest.fn(() => itemQuery),
      updateTable: jest.fn((table: string) => updateQuery(table)),
    };
    const db = {
      transaction: () => ({
        execute: (callback: (value: any) => Promise<unknown>) => callback(trx),
      }),
    };
    const { sync } = buildService({ db });

    await sync.finishSyncRun(
      runId,
      'lease-1',
      'failed',
      'page_template_operation_failed',
    );

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: 'pageTemplateInstances',
        values: expect.objectContaining({
          status: 'error',
          lastErrorCode: 'page_template_operation_failed',
        }),
      }),
    );
  });

  it('commits the fenced draft after a metadata-only source update before signaling the queue', async () => {
    const draft = { type: 'doc', content: [{ type: 'paragraph' }] };
    const template = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      templateKind: 'synced',
      templateArchivedAt: null,
      updatedAt: new Date('2026-08-14T12:00:00.000Z'),
    };
    const lockedTemplate = {
      ...template,
      title: 'Renamed without changing content',
      updatedAt: new Date('2026-08-14T12:05:00.000Z'),
    };
    const revision = {
      id: '019fdaa0-0000-7000-8000-000000000091',
      revision: 1,
    };
    const run = {
      id: '019fdaa0-0000-7000-8000-000000000092',
      status: 'pending',
    };
    const selectQuery = (result: unknown, many = false) => {
      const query: Record<string, jest.Mock> = {};
      for (const method of [
        'innerJoin',
        'select',
        'selectAll',
        'where',
        'orderBy',
        'limit',
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.executeTakeFirst = jest.fn().mockResolvedValue(result);
      query.execute = jest.fn().mockResolvedValue(many ? result : []);
      return query;
    };
    const inserts: Array<{ table: string; values: unknown }> = [];
    const insertQuery = (table: string, result?: unknown) => {
      const query: Record<string, jest.Mock> = {};
      query.values = jest.fn((values: unknown) => {
        inserts.push({ table, values });
        return query;
      });
      query.returningAll = jest.fn(() => query);
      query.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(result);
      query.execute = jest.fn().mockResolvedValue(undefined);
      return query;
    };
    const updates: Array<{ table: string; values: Record<string, unknown> }> =
      [];
    const trx = {
      selectFrom: jest.fn((table: string) =>
        table === 'pageTemplateRevisions'
          ? selectQuery({ revision: 0 })
          : selectQuery(
              [
                {
                  id: '019fdaa0-0000-7000-8000-000000000093',
                  childPageId: consumerPageId,
                },
              ],
              true,
            ),
      ),
      insertInto: jest.fn((table: string) => {
        if (table === 'pageTemplateRevisions') {
          return insertQuery(table, revision);
        }
        if (table === 'pageTemplateSyncRuns') return insertQuery(table, run);
        return insertQuery(table);
      }),
      updateTable: jest.fn((table: string) => {
        const query: any = {};
        query.set = jest.fn((values: Record<string, unknown>) => {
          updates.push({ table, values });
          return query;
        });
        query.where = jest.fn(() => query);
        query.returning = jest.fn(() => query);
        query.returningAll = jest.fn(() => query);
        query.execute = jest.fn().mockResolvedValue(undefined);
        query.executeTakeFirst = jest
          .fn()
          .mockResolvedValue({ id: 'operation' });
        query.executeTakeFirstOrThrow = jest
          .fn()
          .mockResolvedValue(
            table === 'pageTemplateSyncRuns' ? run : undefined,
          );
        return query;
      }),
    };
    let transactionCommitted = false;
    let transactionActive = false;
    const db = {
      transaction: () => ({
        execute: async (callback: (trx: any) => Promise<unknown>) => {
          transactionActive = true;
          try {
            const result = await callback(trx);
            transactionCommitted = true;
            return result;
          } finally {
            transactionActive = false;
          }
        },
      }),
    };
    const queueOutbox = {
      enqueuePageTemplateSync: jest.fn(async (_payload, _dispatchId, tx) => {
        expect(tx).toBe(trx);
        expect(transactionCommitted).toBe(false);
      }),
      kick: jest.fn(() => expect(transactionCommitted).toBe(true)),
    };
    const { sync, content, operations, publication } = buildService({
      db,
      pageRepo: { findById: jest.fn().mockResolvedValue(lockedTemplate) },
      queueOutbox,
    });
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue(template);
    const getLiveContent = jest
      .spyOn(content, 'getLiveContent')
      .mockImplementation(async () => {
        expect(transactionActive).toBe(false);
        return draft;
      });
    jest
      .spyOn(operations, 'findCompletedOperation')
      .mockResolvedValue(undefined);
    jest.spyOn(operations, 'beginOperation').mockResolvedValue({
      id: 'operation',
      status: 'pending',
      leaseToken: 'lease',
    });
    jest.spyOn(operations, 'failOperation').mockResolvedValue(undefined);
    jest
      .spyOn(sync as any, 'findLatestPublishedResult')
      .mockResolvedValue(null);
    jest
      .spyOn(publication, 'normalizeDraftForPublication')
      .mockReturnValue(draft);
    jest.spyOn(sync as any, 'buildPublishPreflight').mockResolvedValue({
      requiresDestructiveConfirmation: false,
    });
    jest
      .spyOn(publication, 'serializeRevision')
      .mockReturnValue({ id: revision.id } as any);
    jest
      .spyOn(publication, 'serializeSyncRun')
      .mockReturnValue({ id: run.id } as any);

    await expect(
      sync.publish(
        sourcePageId,
        { draftHash: hashProseMirrorJson(draft as any) },
        'publish-key',
        user,
      ),
    ).resolves.toEqual({
      revision: { id: revision.id },
      syncRun: { id: run.id },
      idempotent: false,
      noOp: false,
    });

    expect(queueOutbox.enqueuePageTemplateSync).toHaveBeenCalledWith(
      { runId: run.id },
      revision.id,
      trx,
    );
    expect(queueOutbox.kick).toHaveBeenCalledTimes(1);
    expect(getLiveContent).toHaveBeenCalledTimes(2);
    expect(inserts).toContainEqual({
      table: 'pageTemplateRevisions',
      values: expect.objectContaining({
        content: draft,
        contentHash: hashProseMirrorJson(draft as any),
      }),
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: 'pageTemplateInstances',
        values: expect.objectContaining({
          status: 'syncing',
          lastErrorCode: null,
        }),
      }),
    );
  });

  it('enqueues the latest revision when a deleted linked page is restored', async () => {
    const revision = {
      id: '019fdaa0-0000-7000-8000-000000000091',
      templatePageId: sourcePageId,
      revision: 3,
    };
    const run = {
      id: '019fdaa0-0000-7000-8000-000000000092',
      status: 'pending',
    };
    const instanceRow = {
      id: '019fdaa0-0000-7000-8000-000000000093',
      childPageId: consumerPageId,
      templatePageId: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      appliedRevision: 1,
    };
    const queryFor = (table: string) => {
      const query: any = {};
      for (const method of [
        'select',
        'selectAll',
        'innerJoin',
        'where',
        'whereRef',
        'forUpdate',
        'orderBy',
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.execute = jest
        .fn()
        .mockResolvedValue(
          table === 'pageTemplateInstances as instance'
            ? [instanceRow]
            : table === 'pageTemplateRevisions'
              ? [revision]
              : [],
        );
      return query;
    };
    const inserted: Array<{ table: string; values: unknown }> = [];
    const insertFor = (table: string) => {
      const query: any = {};
      query.values = jest.fn((values: unknown) => {
        inserted.push({ table, values });
        return query;
      });
      query.returningAll = jest.fn(() => query);
      query.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(run);
      query.execute = jest.fn().mockResolvedValue(undefined);
      return query;
    };
    const instanceUpdates: Record<string, unknown>[] = [];
    const trx = {
      selectFrom: jest.fn((table: string) => queryFor(table)),
      insertInto: jest.fn((table: string) => insertFor(table)),
      updateTable: jest.fn(() => {
        const query: any = {};
        query.set = jest.fn((values: Record<string, unknown>) => {
          instanceUpdates.push(values);
          return query;
        });
        query.where = jest.fn(() => query);
        query.execute = jest.fn().mockResolvedValue(undefined);
        return query;
      }),
    };
    let committed = false;
    const db = {
      transaction: () => ({
        execute: async (callback: (value: any) => Promise<unknown>) => {
          const result = await callback(trx);
          committed = true;
          return result;
        },
      }),
    };
    const queueOutbox = {
      enqueuePageTemplateSync: jest.fn(async (_payload, _dispatchId, tx) => {
        expect(tx).toBe(trx);
        expect(committed).toBe(false);
      }),
      kick: jest.fn(() => expect(committed).toBe(true)),
    };
    const { sync } = buildService({ db, queueOutbox });

    await sync.catchUpRestoredInstances([consumerPageId], user);

    expect(inserted).toContainEqual({
      table: 'pageTemplateSyncItems',
      values: [
        {
          runId: run.id,
          instanceId: instanceRow.id,
          childPageId: consumerPageId,
        },
      ],
    });
    expect(instanceUpdates).toContainEqual(
      expect.objectContaining({ status: 'syncing', lastErrorCode: null }),
    );
    expect(queueOutbox.enqueuePageTemplateSync).toHaveBeenCalledWith(
      { runId: run.id },
      revision.id,
      trx,
    );
    expect(queueOutbox.kick).toHaveBeenCalledTimes(1);
  });

  it('returns the readable source template for a completed snapshot', async () => {
    const results = [null, { sourcePageId }, { revision: null }];
    const db = {
      selectFrom: jest.fn(() => {
        const query: any = {};
        for (const method of ['select', 'selectAll', 'where', 'orderBy']) {
          query[method] = jest.fn(() => query);
        }
        query.executeTakeFirst = jest.fn(async () => results.shift());
        return query;
      }),
    };
    const targetPage = {
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
    };
    const sourcePage = {
      id: sourcePageId,
      slugId: 'source-slug',
      title: 'Source template',
      icon: '📄',
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
      space: { slug: 'docs' },
    };
    const pageRepo = {
      findById: jest.fn(async (id: string) =>
        id === consumerPageId ? targetPage : sourcePage,
      ),
    };
    const pageAccessService = {
      assertCanReadPage: jest.fn(),
      getEffectiveAccess: jest.fn(async () => ({
        capabilities: { canRead: true },
      })),
    };
    const { instance } = buildService({ db, pageRepo, pageAccessService });

    await expect(instance.getProvenance(consumerPageId, user)).resolves.toEqual(
      {
        createdFromTemplate: true,
        kind: 'regular',
        status: 'snapshot',
        appliedRevision: null,
        latestRevision: null,
        provenanceState: 'linked',
        canReadTemplate: true,
        canDetach: false,
        canCreateIndependentCopy: false,
        lastErrorCode: null,
        sourceTemplate: {
          id: sourcePageId,
          slugId: 'source-slug',
          title: 'Source template',
          icon: '📄',
          spaceSlug: 'docs',
        },
      },
    );
    expect(pageAccessService.getEffectiveAccess).toHaveBeenCalledWith(
      targetPage,
      user,
    );
  });

  it('does not expose a source template from another space', async () => {
    const results = [null, { sourcePageId }, { revision: null }];
    const db = {
      selectFrom: jest.fn(() => {
        const query: any = {};
        for (const method of ['select', 'selectAll', 'where', 'orderBy']) {
          query[method] = jest.fn(() => query);
        }
        query.executeTakeFirst = jest.fn(async () => results.shift());
        return query;
      }),
    };
    const targetPage = {
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: targetSpaceId,
      deletedAt: null,
    };
    const sourcePage = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
    };
    const pageRepo = {
      findById: jest.fn(async (id: string) =>
        id === consumerPageId ? targetPage : sourcePage,
      ),
    };
    const pageAccessService = {
      assertCanReadPage: jest.fn(),
      getEffectiveAccess: jest.fn(async () => ({
        capabilities: { canRead: true, canWrite: false },
      })),
    };
    const { instance } = buildService({ db, pageRepo, pageAccessService });

    await expect(instance.getProvenance(consumerPageId, user)).resolves.toEqual(
      {
        createdFromTemplate: true,
        kind: 'regular',
        status: 'snapshot',
        appliedRevision: null,
        latestRevision: null,
        provenanceState: 'invalid',
        canReadTemplate: false,
        canDetach: false,
        canCreateIndependentCopy: false,
        lastErrorCode: 'page_template_source_invalid',
        sourceTemplate: null,
      },
    );
    expect(pageAccessService.getEffectiveAccess).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a missing template source from restricted source access', async () => {
    const makeDb = () => {
      const results = [null, { sourcePageId }, { revision: 2 }];
      return {
        selectFrom: jest.fn(() => {
          const query: any = {};
          for (const method of ['select', 'selectAll', 'where', 'orderBy']) {
            query[method] = jest.fn(() => query);
          }
          query.executeTakeFirst = jest.fn(async () => results.shift());
          return query;
        }),
      };
    };
    const targetPage = {
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
    };

    const missing = buildService({
      db: makeDb(),
      pageRepo: {
        findById: jest.fn(async (id: string) =>
          id === consumerPageId ? targetPage : null,
        ),
      },
      pageAccessService: {
        getEffectiveAccess: jest.fn().mockResolvedValue({
          capabilities: { canRead: true, canWrite: true },
        }),
      },
    }).instance;
    await expect(
      missing.getProvenance(consumerPageId, user),
    ).resolves.toMatchObject({
      createdFromTemplate: true,
      provenanceState: 'source_missing',
      canReadTemplate: false,
      sourceTemplate: null,
      lastErrorCode: 'page_template_source_missing',
    });

    const sourcePage = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
      space: { slug: 'docs' },
    };
    const restrictedAccess = jest
      .fn()
      .mockResolvedValueOnce({
        capabilities: { canRead: true, canWrite: true },
      })
      .mockResolvedValueOnce({
        capabilities: { canRead: false, canWrite: false },
      });
    const restricted = buildService({
      db: makeDb(),
      pageRepo: {
        findById: jest.fn(async (id: string) =>
          id === consumerPageId ? targetPage : sourcePage,
        ),
      },
      pageAccessService: { getEffectiveAccess: restrictedAccess },
    }).instance;
    await expect(
      restricted.getProvenance(consumerPageId, user),
    ).resolves.toMatchObject({
      createdFromTemplate: true,
      provenanceState: 'restricted',
      canReadTemplate: false,
      sourceTemplate: null,
      lastErrorCode: null,
    });
  });

  it('exposes independent-copy capability without requiring source write access', async () => {
    const results = [
      {
        templatePageId: sourcePageId,
        instanceKind: 'synced',
        status: 'error',
        appliedRevision: 1,
        lastErrorCode: 'page_template_child_missing',
      },
      { revision: 2 },
    ];
    const db = {
      selectFrom: jest.fn(() => {
        const query: any = {};
        for (const method of ['select', 'selectAll', 'where', 'orderBy']) {
          query[method] = jest.fn(() => query);
        }
        query.executeTakeFirst = jest.fn(async () => results.shift());
        return query;
      }),
    };
    const targetPage = {
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
    };
    const sourcePage = {
      id: sourcePageId,
      slugId: 'source-slug',
      title: 'Source template',
      icon: null,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
      space: { slug: 'docs' },
    };
    const pageRepo = {
      findById: jest.fn(async (id: string) =>
        id === consumerPageId ? targetPage : sourcePage,
      ),
    };
    const pageAccessService = {
      getEffectiveAccess: jest.fn().mockResolvedValue({
        capabilities: { canRead: true, canWrite: false },
      }),
    };
    const { instance } = buildService({ db, pageRepo, pageAccessService });

    await expect(
      instance.getProvenance(consumerPageId, user),
    ).resolves.toMatchObject({
      createdFromTemplate: true,
      status: 'error',
      canDetach: false,
      canCreateIndependentCopy: true,
      lastErrorCode: 'page_template_child_missing',
    });
  });

  it('returns disabled discovery capabilities without querying pages', async () => {
    const policy = {
      resolveForUser: jest.fn(async () => ({
        systemEnabled: true,
        workspaceEnabled: true,
        templatesEnabled: false,
        allowCreateTemplate: true,
        allowRegularTemplate: true,
        allowSyncedTemplate: true,
        allowedActions: [
          'create_template',
          'use_regular_template',
          'use_synced_template',
        ],
      })),
    };
    const { instance } = buildService({ policy });

    await expect(
      instance.discover({ spaceId: sourceSpaceId, limit: 20 }, user),
    ).resolves.toEqual({
      items: [],
      nextCursor: null,
      capabilities: {
        enabled: false,
        createTemplate: false,
        manageTemplate: false,
        useRegular: false,
        useSynced: false,
      },
    });
  });

  it('rejects cross-space snapshots before checking destination policy', async () => {
    const { instance, policy, operations, content } = buildService();
    jest.spyOn(operations, 'findCompletedOperation').mockResolvedValue(null);
    jest.spyOn(content, 'requireTemplateSource').mockResolvedValue({
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      templateKind: 'regular',
    } as any);

    await expect(
      instance.createFromTemplate(
        { templatePageId: sourcePageId, spaceId: targetSpaceId },
        'snapshot-key',
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(policy.assertAction).not.toHaveBeenCalled();
  });

  it.each([
    {
      state: 'archived',
      lockedSource: { deletedAt: null, templateArchivedAt: new Date() },
      code: 'page_template_archived',
    },
    {
      state: 'deleted',
      lockedSource: { deletedAt: new Date(), templateArchivedAt: null },
      code: 'page_template_source_changed',
    },
  ])(
    'rechecks a template source that becomes $state after content staging',
    async ({ lockedSource, code }) => {
      const trx = {};
      const db = {
        transaction: jest.fn(() => ({
          execute: (callback: (transaction: unknown) => Promise<unknown>) =>
            callback(trx),
        })),
      };
      const source = {
        id: sourcePageId,
        title: 'Template',
        icon: null,
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
        templateKind: 'regular',
        templateArchivedAt: null,
        deletedAt: null,
      };
      const pageRepo = {
        findById: jest.fn(async (id: string, options?: unknown) => {
          if (id === consumerPageId) return undefined;
          if (id === sourcePageId && options) {
            return { ...source, ...lockedSource };
          }
          return source;
        }),
      };
      const pageService = {
        create: jest.fn(),
        finalizeCreatedPage: jest.fn(),
      };
      const { instance, content, operations, policy } = buildService({
        db,
        pageRepo,
        pageService,
      });
      jest.spyOn(operations, 'findCompletedOperation').mockResolvedValue(null);
      jest
        .spyOn(content, 'requireTemplateSource')
        .mockResolvedValue(source as any);
      jest.spyOn(content, 'assertCanCreate').mockResolvedValue(undefined);
      jest.spyOn(content, 'copyAttachments').mockResolvedValue([]);
      jest.spyOn(operations, 'beginOperation').mockResolvedValue({
        id: 'operation-source-fence',
        status: 'pending',
        resultPageId: consumerPageId,
        leaseToken: 'lease-source-fence',
        stagedContent: { type: 'doc', content: [{ type: 'paragraph' }] },
        attachmentMapping: [],
      } as any);
      jest
        .spyOn(operations, 'assertOperationLease')
        .mockResolvedValue(undefined);
      jest.spyOn(operations, 'ownsOperationLease').mockResolvedValue(false);

      await expect(
        instance.createFromTemplate(
          { templatePageId: sourcePageId, spaceId: sourceSpaceId },
          `source-fence-${code}`,
          user,
        ),
      ).rejects.toMatchObject({ response: { code } });

      expect(policy.assertAction).toHaveBeenCalled();
      expect(pageRepo.findById).toHaveBeenCalledWith(sourcePageId, {
        withLock: true,
        trx,
      });
      expect(pageService.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a synchronized create when a newer revision is published during staging', async () => {
    const publishedRevision = {
      id: '019fdaa0-0000-7000-8000-000000000091',
      templatePageId: sourcePageId,
      revision: 1,
      contentHash: 'revision-one',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    };
    const revisionQuery = (result: unknown) => {
      const query: any = {};
      for (const method of ['select', 'selectAll', 'where', 'orderBy']) {
        query[method] = jest.fn(() => query);
      }
      query.executeTakeFirst = jest.fn().mockResolvedValue(result);
      return query;
    };
    const trx = {
      selectFrom: jest.fn(() =>
        revisionQuery({
          id: '019fdaa0-0000-7000-8000-000000000092',
          revision: 2,
          contentHash: 'revision-two',
        }),
      ),
    };
    const db = {
      selectFrom: jest.fn(() => revisionQuery(publishedRevision)),
      transaction: jest.fn(() => ({
        execute: (callback: (transaction: unknown) => Promise<unknown>) =>
          callback(trx),
      })),
    };
    const source = {
      id: sourcePageId,
      title: 'Synced template',
      icon: null,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      templateKind: 'synced',
      templateArchivedAt: null,
      deletedAt: null,
    };
    const pageRepo = {
      findById: jest.fn(async (id: string, options?: unknown) => {
        if (id === consumerPageId) return undefined;
        if (id === sourcePageId && options) return source;
        return source;
      }),
    };
    const pageService = { create: jest.fn(), finalizeCreatedPage: jest.fn() };
    const { instance, content, operations } = buildService({
      db,
      pageRepo,
      pageService,
    });
    jest.spyOn(operations, 'findCompletedOperation').mockResolvedValue(null);
    jest
      .spyOn(content, 'requireTemplateSource')
      .mockResolvedValue(source as any);
    jest.spyOn(content, 'assertCanCreate').mockResolvedValue(undefined);
    jest.spyOn(content, 'copyAttachments').mockResolvedValue([]);
    jest.spyOn(operations, 'beginOperation').mockResolvedValue({
      id: 'operation-revision-fence',
      status: 'pending',
      resultPageId: consumerPageId,
      leaseToken: 'lease-revision-fence',
      stagedContent: { type: 'doc', content: [{ type: 'paragraph' }] },
      attachmentMapping: [],
    } as any);
    jest.spyOn(operations, 'assertOperationLease').mockResolvedValue(undefined);
    jest.spyOn(operations, 'ownsOperationLease').mockResolvedValue(false);

    await expect(
      instance.createFromTemplate(
        { templatePageId: sourcePageId, spaceId: sourceSpaceId },
        'revision-fence',
        user,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'page_template_source_changed' },
    });
    expect(trx.selectFrom).toHaveBeenCalledWith('pageTemplateRevisions');
    expect(pageService.create).not.toHaveBeenCalled();
  });

  it('updates sync-run progress after every processed item', async () => {
    const runId = '019fdaa0-0000-7000-8000-000000000098';
    const claimedRun = {
      id: runId,
      revisionId: 'revision-1',
      requestedById: user.id,
      workspaceId: user.workspaceId,
      templatePageId: sourcePageId,
    };
    let syncRunUpdateCount = 0;
    const db = {
      updateTable: jest.fn((table: string) => {
        const query: any = {};
        for (const method of ['set', 'where', 'returningAll', 'returning']) {
          query[method] = jest.fn(() => query);
        }
        query.execute = jest.fn().mockResolvedValue(undefined);
        query.executeTakeFirst = jest.fn(async () => {
          if (table !== 'pageTemplateSyncRuns') return undefined;
          syncRunUpdateCount += 1;
          return syncRunUpdateCount === 1 ? claimedRun : { id: runId };
        });
        return query;
      }),
      selectFrom: jest.fn((table: string) => {
        const query: any = {};
        for (const method of ['selectAll', 'where', 'orderBy', 'limit']) {
          query[method] = jest.fn(() => query);
        }
        query.executeTakeFirst = jest.fn(async () => {
          if (table === 'pageTemplateRevisions') return { id: 'revision-1' };
          if (table === 'users') return user;
          return undefined;
        });
        query.execute = jest.fn(async () =>
          table === 'pageTemplateSyncItems'
            ? [
                { id: 'item-1', createdAt: new Date(0) },
                { id: 'item-2', createdAt: new Date(1) },
              ]
            : [],
        );
        return query;
      }),
    };
    const events: string[] = [];
    const templateSync = {
      processSyncItem: jest.fn(async (_run, _revision, item) => {
        events.push(`item:${item.id}`);
      }),
      updateSyncRunProgress: jest.fn(async () => {
        events.push('progress');
        return true;
      }),
      recalculateSyncRun: jest.fn().mockResolvedValue(undefined),
      finishSyncRun: jest.fn().mockResolvedValue(undefined),
    };
    const runtime = new PageTemplateRuntimeService(
      db as any,
      {} as any,
      templateSync as any,
      {} as any,
    );

    await (runtime as any).processSyncRun(runId);

    expect(events).toEqual([
      'item:item-1',
      'progress',
      'item:item-2',
      'progress',
    ]);
    expect(templateSync.updateSyncRunProgress).toHaveBeenCalledTimes(2);
    expect(templateSync.recalculateSyncRun).toHaveBeenCalledWith(
      runId,
      expect.any(String),
    );
  });

  it('loads large synchronization runs in bounded keyset batches', async () => {
    const runId = '019fdaa0-0000-7000-8000-000000000089';
    const claimedRun = {
      id: runId,
      revisionId: 'revision-1',
      requestedById: user.id,
      workspaceId: user.workspaceId,
      templatePageId: sourcePageId,
    };
    const pendingItems = Array.from({ length: 205 }, (_, index) => ({
      id: `item-${String(index).padStart(3, '0')}`,
    }));
    let syncRunUpdateCount = 0;
    const itemBatchLimits: number[] = [];
    const db = {
      updateTable: jest.fn((table: string) => {
        const query: any = {};
        for (const method of ['set', 'where', 'returningAll', 'returning']) {
          query[method] = jest.fn(() => query);
        }
        query.execute = jest.fn().mockResolvedValue(undefined);
        query.executeTakeFirst = jest.fn(async () => {
          if (table !== 'pageTemplateSyncRuns') return undefined;
          syncRunUpdateCount += 1;
          return syncRunUpdateCount === 1 ? claimedRun : { id: runId };
        });
        return query;
      }),
      selectFrom: jest.fn((table: string) => {
        const query: any = {};
        let afterId: string | null = null;
        let limit = pendingItems.length;
        query.selectAll = jest.fn(() => query);
        query.where = jest.fn(
          (field: string, operator: string, value: unknown) => {
            if (field === 'id' && operator === '>') afterId = String(value);
            return query;
          },
        );
        query.orderBy = jest.fn(() => query);
        query.limit = jest.fn((value: number) => {
          limit = value;
          if (table === 'pageTemplateSyncItems') itemBatchLimits.push(value);
          return query;
        });
        query.executeTakeFirst = jest.fn(async () => {
          if (table === 'pageTemplateRevisions') return { id: 'revision-1' };
          if (table === 'users') return user;
          return undefined;
        });
        query.execute = jest.fn(async () =>
          table === 'pageTemplateSyncItems'
            ? pendingItems
                .filter((item) => !afterId || item.id > afterId)
                .slice(0, limit)
            : [],
        );
        return query;
      }),
    };
    const templateSync = {
      processSyncItem: jest.fn().mockResolvedValue(undefined),
      updateSyncRunProgress: jest.fn().mockResolvedValue(true),
      recalculateSyncRun: jest.fn().mockResolvedValue(undefined),
      finishSyncRun: jest.fn().mockResolvedValue(undefined),
    };
    const runtime = new PageTemplateRuntimeService(
      db as any,
      {} as any,
      templateSync as any,
      {} as any,
    );

    await (runtime as any).processSyncRun(runId);

    expect(itemBatchLimits).toEqual([100, 100, 100]);
    expect(templateSync.processSyncItem).toHaveBeenCalledTimes(205);
    expect(templateSync.updateSyncRunProgress).toHaveBeenCalledTimes(205);
    expect(templateSync.recalculateSyncRun).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation when a removed field could receive a concurrent value', async () => {
    const fieldId = '019fdaa0-0000-7000-8000-000000000090';
    const previous = {
      type: 'doc',
      content: [
        {
          type: 'templateField',
          attrs: { fieldId, label: 'Owner', placeholder: 'Enter a value' },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    const queryFor = (table: string) => {
      const query: any = {};
      for (const method of [
        'select',
        'selectAll',
        'innerJoin',
        'where',
        'orderBy',
        'limit',
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.executeTakeFirst = jest.fn(async () => {
        if (table === 'pageTemplateRevisions') {
          return { revision: 1, content: previous };
        }
        if (table === 'pageTemplateInstances as instance') {
          return { count: 1 };
        }
        return undefined;
      });
      query.execute = jest.fn(async () =>
        table === 'pageTemplateInstances as instance'
          ? [
              {
                id: 'instance-1',
                childPageId: consumerPageId,
                content: previous,
              },
            ]
          : [],
      );
      return query;
    };
    const db = { selectFrom: jest.fn((table: string) => queryFor(table)) };
    const { sync, content } = buildService({ db });
    jest.spyOn(content, 'getLiveContent').mockResolvedValue(previous);

    const result = await (sync as any).buildPublishPreflight(
      { id: sourcePageId },
      user,
      false,
      { type: 'doc', content: [{ type: 'paragraph' }] },
    );

    expect(result.filledRemovedFieldInstanceCount).toBe(0);
    expect(result.requiresDestructiveConfirmation).toBe(true);
    expect(result.confirmationToken).toBeNull();
  });

  it('counts a removed field value from live collaboration content newer than the persisted snapshot', async () => {
    const fieldId = '019fdaa0-0000-7000-8000-000000000090';
    const emptyField = {
      type: 'doc',
      content: [
        {
          type: 'templateField',
          attrs: { fieldId, label: 'Owner', placeholder: 'Enter a value' },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    const liveFilledField = {
      type: 'doc',
      content: [
        {
          type: 'templateField',
          attrs: { fieldId, label: 'Owner', placeholder: 'Enter a value' },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Assigned live' }],
            },
          ],
        },
      ],
    };
    const queryFor = (table: string) => {
      const query: any = {};
      for (const method of [
        'select',
        'selectAll',
        'innerJoin',
        'where',
        'orderBy',
        'limit',
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.executeTakeFirst = jest.fn(async () => {
        if (table === 'pageTemplateRevisions') {
          return { revision: 1, content: emptyField };
        }
        if (table === 'pageTemplateInstances as instance') {
          return { count: 1 };
        }
        return undefined;
      });
      query.execute = jest.fn(async () =>
        table === 'pageTemplateInstances as instance'
          ? [
              {
                id: 'instance-1',
                childPageId: consumerPageId,
                content: emptyField,
              },
            ]
          : [],
      );
      return query;
    };
    const { sync, content } = buildService({
      db: { selectFrom: jest.fn((table: string) => queryFor(table)) },
    });
    jest.spyOn(content, 'getLiveContent').mockResolvedValue(liveFilledField);

    const result = await (sync as any).buildPublishPreflight(
      { id: sourcePageId },
      user,
      false,
      { type: 'doc', content: [] },
    );

    expect(result.filledRemovedFieldInstanceCount).toBe(1);
    expect(result.requiresDestructiveConfirmation).toBe(true);
  });

  it('skips instance live reads when publication removes no fields', async () => {
    const fieldId = '019fdaa0-0000-7000-8000-000000000090';
    const unchanged = {
      type: 'doc',
      content: [
        {
          type: 'templateField',
          attrs: { fieldId, label: 'Owner', placeholder: 'Enter a value' },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    let activeCountQuery: any;
    const queryFor = (table: string) => {
      const query: any = {};
      for (const method of [
        'select',
        'selectAll',
        'innerJoin',
        'where',
        'orderBy',
        'limit',
      ]) {
        query[method] = jest.fn(() => query);
      }
      if (table === 'pageTemplateInstances as instance') {
        activeCountQuery = query;
      }
      query.executeTakeFirst = jest.fn(async () => {
        if (table === 'pageTemplateRevisions') {
          return { revision: 1, content: unchanged };
        }
        if (table === 'pageTemplateInstances as instance') return { count: 1 };
        return undefined;
      });
      query.execute = jest.fn(async () =>
        table === 'pageTemplateInstances as instance'
          ? [
              {
                id: 'instance-1',
                childPageId: consumerPageId,
                content: unchanged,
              },
            ]
          : [],
      );
      return query;
    };
    const { sync, content } = buildService({
      db: { selectFrom: jest.fn((table: string) => queryFor(table)) },
    });
    const getLiveContent = jest.spyOn(content, 'getLiveContent');

    const result = await (sync as any).buildPublishPreflight(
      { id: sourcePageId },
      user,
      false,
      unchanged,
    );

    expect(result.activeInstanceCount).toBe(1);
    expect(result.filledRemovedFieldInstanceCount).toBe(0);
    expect(result.requiresDestructiveConfirmation).toBe(false);
    expect(getLiveContent).not.toHaveBeenCalled();
    expect(activeCountQuery.innerJoin).toHaveBeenCalledWith(
      'pages as child',
      'child.id',
      'instance.childPageId',
    );
    expect(activeCountQuery.where).toHaveBeenCalledWith(
      'child.deletedAt',
      'is',
      null,
    );
  });

  it('caps destructive live-content reads and counts unsampled instances conservatively', async () => {
    const fieldId = '019fdaa0-0000-7000-8000-000000000090';
    const emptyField = {
      type: 'doc',
      content: [
        {
          type: 'templateField',
          attrs: { fieldId, label: 'Owner', placeholder: 'Enter a value' },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    const instances = Array.from({ length: 250 }, (_, index) => ({
      id: `instance-${index}`,
      childPageId: `child-${index}`,
      content: emptyField,
    }));
    const instanceQueries: any[] = [];
    const queryFor = (table: string) => {
      const query: any = {};
      let queryLimit = Number.POSITIVE_INFINITY;
      for (const method of [
        'select',
        'selectAll',
        'innerJoin',
        'where',
        'orderBy',
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.limit = jest.fn((value: number) => {
        queryLimit = value;
        return query;
      });
      if (table === 'pageTemplateInstances as instance') {
        instanceQueries.push(query);
      }
      query.executeTakeFirst = jest.fn(async () => {
        if (table === 'pageTemplateRevisions') {
          return { revision: 1, content: emptyField };
        }
        if (table === 'pageTemplateInstances as instance') {
          return { count: instances.length };
        }
        return undefined;
      });
      query.execute = jest.fn(async () =>
        table === 'pageTemplateInstances as instance'
          ? instances.slice(0, queryLimit)
          : [],
      );
      return query;
    };
    const { sync, content } = buildService({
      db: { selectFrom: jest.fn((table: string) => queryFor(table)) },
    });
    let activeReads = 0;
    let maxActiveReads = 0;
    const getLiveContent = jest
      .spyOn(content, 'getLiveContent')
      .mockImplementation(async () => {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await Promise.resolve();
        activeReads -= 1;
        return emptyField;
      });

    const result = await (sync as any).buildPublishPreflight(
      { id: sourcePageId },
      user,
      false,
      { type: 'doc', content: [] },
    );

    expect(result.activeInstanceCount).toBe(250);
    expect(result.filledRemovedFieldInstanceCount).toBe(150);
    expect(getLiveContent).toHaveBeenCalledTimes(100);
    expect(maxActiveReads).toBeLessThanOrEqual(5);
    expect(instanceQueries[0].limit).toHaveBeenCalledWith(100);
  });

  it('bounds discovery ACL filtering and returns a continuation cursor for an empty hidden window', async () => {
    const candidateWindow = Array.from({ length: 6 }, (_, index) => ({
      id: `hidden-${index}`,
      slugId: `hidden-slug-${index}`,
      title: `Hidden ${index}`,
      icon: null,
      spaceId: sourceSpaceId,
      workspaceId: user.workspaceId,
      parentPageId: null,
      deletedAt: null,
      updatedAt: new Date(),
      templateKind: 'regular',
      templateArchivedAt: null,
      spaceName: 'Docs',
      spaceSlug: 'docs',
    }));
    const query: any = {};
    for (const method of [
      'innerJoin',
      'select',
      'where',
      'orderBy',
      'offset',
      'limit',
    ]) {
      query[method] = jest.fn(() => query);
    }
    query.execute = jest.fn().mockResolvedValue(candidateWindow);
    const pageRepo = {
      findById: jest.fn(),
      getRecentPagesInSpace: jest.fn().mockResolvedValue({ items: [] }),
    };
    const pageAccessService = {
      getEffectiveAccessForPages: jest.fn(
        async (pages: Array<{ id: string }>) =>
          new Map(
            pages.map((page) => [
              page.id,
              { capabilities: { canRead: false } },
            ]),
          ),
      ),
    };
    const { instance } = buildService({
      db: { selectFrom: jest.fn(() => query) },
      pageRepo,
      pageAccessService,
    });
    jest.spyOn(instance as any, 'resolveCapabilities').mockResolvedValue({
      capabilities: {
        enabled: true,
        createTemplate: true,
        manageTemplate: true,
        useRegular: true,
        useSynced: true,
      },
    });

    const result = await instance.discover(
      { spaceId: sourceSpaceId, limit: 1 },
      user,
    );
    expect(result.items).toEqual([]);
    expect(
      JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString('utf8')),
    ).toMatchObject({
      version: 1,
      type: 'page',
      id: 'hidden-5',
    });
    expect(query.execute).toHaveBeenCalledTimes(1);
    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(pageAccessService.getEffectiveAccessForPages).toHaveBeenCalledTimes(
      1,
    );
    expect(
      pageAccessService.getEffectiveAccessForPages.mock.calls[0][0],
    ).toHaveLength(6);
  });

  it('keeps discovery pagination stable when a returned page is updated and a new page is inserted', async () => {
    const pageRows = [3, 2, 1].map((number) => ({
      id: `019fdaa0-0000-7000-8000-00000000008${number}`,
      slugId: `template-${number}`,
      title: `Template ${number}`,
      icon: null,
      spaceId: sourceSpaceId,
      workspaceId: user.workspaceId,
      parentPageId: null,
      deletedAt: null,
      updatedAt: new Date(`2026-08-14T12:0${number}:00.000Z`),
      templateKind: 'regular',
      templateArchivedAt: null,
      spaceName: 'Docs',
      spaceSlug: 'docs',
    }));
    const makePageQuery = () => {
      const predicates: Array<(eb: any) => boolean> = [];
      let queryLimit = Number.POSITIVE_INFINITY;
      const query: any = {};
      for (const method of ['innerJoin', 'select', 'orderBy']) {
        query[method] = jest.fn(() => query);
      }
      query.where = jest.fn((value: unknown) => {
        if (typeof value === 'function') {
          predicates.push(value as (eb: any) => boolean);
        }
        return query;
      });
      query.limit = jest.fn((value: number) => {
        queryLimit = value;
        return query;
      });
      query.execute = jest.fn(async () => {
        const subquery: any = {};
        for (const method of ['select', 'whereRef', 'where']) {
          subquery[method] = jest.fn(() => subquery);
        }
        const evaluate = (row: any, predicate: (eb: any) => boolean) => {
          const eb: any = (field: string, operator: string, value: any) => {
            const left = row[field.replace('page.', '')];
            const normalizedLeft = left instanceof Date ? left.getTime() : left;
            const normalizedRight =
              value instanceof Date ? value.getTime() : value;
            if (operator === '<') return normalizedLeft < normalizedRight;
            if (operator === '=') return normalizedLeft === normalizedRight;
            throw new Error(`Unsupported operator ${operator}`);
          };
          eb.or = (values: boolean[]) => values.some(Boolean);
          eb.and = (values: boolean[]) => values.every(Boolean);
          eb.exists = () => false;
          eb.not = (value: boolean) => !value;
          eb.selectFrom = () => subquery;
          return predicate(eb);
        };
        return pageRows
          .filter((row) =>
            predicates.every((predicate) => evaluate(row, predicate)),
          )
          .sort(
            (left, right) =>
              right.updatedAt.getTime() - left.updatedAt.getTime() ||
              right.id.localeCompare(left.id),
          )
          .slice(0, queryLimit);
      });
      return query;
    };
    const makeEmptyQuery = () => {
      const query: any = {};
      for (const method of ['select', 'where', 'groupBy']) {
        query[method] = jest.fn(() => query);
      }
      query.execute = jest.fn().mockResolvedValue([]);
      return query;
    };
    const pageRepo = {
      findById: jest.fn(),
      getRecentPagesInSpace: jest.fn().mockResolvedValue({ items: [] }),
    };
    const pageAccessService = {
      getEffectiveAccessForPages: jest.fn(
        async (pages: Array<{ id: string }>) =>
          new Map(
            pages.map((page) => [
              page.id,
              { capabilities: { canRead: true, canWrite: true } },
            ]),
          ),
      ),
    };
    const { instance } = buildService({
      db: {
        selectFrom: jest.fn((table: string) =>
          table === 'pages as page' ? makePageQuery() : makeEmptyQuery(),
        ),
      },
      pageRepo,
      pageAccessService,
    });
    jest.spyOn(instance as any, 'resolveCapabilities').mockResolvedValue({
      capabilities: {
        enabled: true,
        createTemplate: true,
        manageTemplate: true,
        useRegular: true,
        useSynced: true,
      },
    });

    const first = await instance.discover(
      { spaceId: sourceSpaceId, limit: 2 },
      user,
    );
    expect(first.items.map((item) => item.id)).toEqual([
      '019fdaa0-0000-7000-8000-000000000083',
      '019fdaa0-0000-7000-8000-000000000082',
    ]);
    pageRows[0].updatedAt = new Date('2026-08-14T12:10:00.000Z');
    pageRows.unshift({
      id: '019fdaa0-0000-7000-8000-000000000084',
      slugId: 'template-4',
      title: 'Template 4',
      icon: null,
      spaceId: sourceSpaceId,
      workspaceId: user.workspaceId,
      parentPageId: null,
      deletedAt: null,
      updatedAt: new Date('2026-08-14T12:11:00.000Z'),
      templateKind: 'regular',
      templateArchivedAt: null,
      spaceName: 'Docs',
      spaceSlug: 'docs',
    });

    const second = await instance.discover(
      { spaceId: sourceSpaceId, limit: 2, cursor: first.nextCursor! },
      user,
    );
    expect(second.items.map((item) => item.id)).toEqual([
      '019fdaa0-0000-7000-8000-000000000081',
    ]);
    expect(second.nextCursor).toBeNull();
    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(pageAccessService.getEffectiveAccessForPages).toHaveBeenCalledTimes(
      2,
    );
  });

  it('returns only destinations where child creation is allowed', async () => {
    const query: any = {};
    for (const method of ['select', 'where', 'orderBy', 'offset', 'limit']) {
      query[method] = jest.fn(() => query);
    }
    query.execute = jest.fn(async () => [{ id: 'allowed' }, { id: 'denied' }]);
    const db = { selectFrom: jest.fn(() => query) };
    const pages = {
      allowed: {
        id: 'allowed',
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
        slugId: 'allowed-slug',
        title: 'Allowed',
        icon: null,
        parentPageId: null,
        deletedAt: null,
      },
      denied: {
        id: 'denied',
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
        slugId: 'denied-slug',
        title: 'Denied',
        icon: null,
        parentPageId: null,
        deletedAt: null,
      },
    };
    const pageRepo = {
      findById: jest.fn(async (id: 'allowed' | 'denied') => pages[id]),
    };
    const pageAccessService = {
      getEffectiveAccessForPages: jest.fn(
        async () =>
          new Map([
            [
              'allowed',
              { capabilities: { canCreateChild: true, canRead: false } },
            ],
            [
              'denied',
              { capabilities: { canCreateChild: false, canRead: true } },
            ],
          ]),
      ),
    };
    const { instance } = buildService({ db, pageRepo, pageAccessService });

    await expect(
      instance.listDestinations({ spaceId: sourceSpaceId, limit: 20 }, user),
    ).resolves.toMatchObject({
      rootAllowed: true,
      items: [{ id: 'allowed' }],
      nextCursor: null,
    });

    await expect(
      instance.listDestinations(
        { spaceId: sourceSpaceId, purpose: 'source', limit: 20 },
        user,
      ),
    ).resolves.toMatchObject({
      rootAllowed: false,
      items: [{ id: 'denied' }],
    });
  });

  it('uses the canonical source filters for an exact preselected page', async () => {
    const pageId = '019fdaa0-0000-7000-8000-000000000075';
    const subquery: any = {};
    for (const method of ['select', 'whereRef', 'where']) {
      subquery[method] = jest.fn(() => subquery);
    }
    const eb: any = jest.fn(() => true);
    eb.not = jest.fn((value) => value);
    eb.exists = jest.fn((value) => value);
    eb.selectFrom = jest.fn(() => subquery);
    const query: any = {};
    for (const method of ['select', 'orderBy', 'limit']) {
      query[method] = jest.fn(() => query);
    }
    query.where = jest.fn((...args: unknown[]) => {
      if (typeof args[0] === 'function') args[0](eb);
      return query;
    });
    query.execute = jest
      .fn()
      .mockResolvedValue([
        { id: pageId, updatedAt: new Date('2026-08-14T12:00:00.000Z') },
      ]);
    const page = {
      id: pageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      slugId: 'current-page',
      title: 'Current title',
      icon: null,
      parentPageId: null,
      deletedAt: null,
    };
    const { instance } = buildService({
      db: { selectFrom: jest.fn(() => query) },
      pageRepo: { findById: jest.fn().mockResolvedValue(page) },
      pageAccessService: {
        getEffectiveAccessForPages: jest
          .fn()
          .mockResolvedValue(
            new Map([
              [
                pageId,
                { capabilities: { canRead: true, canCreateChild: true } },
              ],
            ]),
          ),
      },
    });

    await expect(
      instance.listDestinations(
        {
          spaceId: sourceSpaceId,
          purpose: 'source',
          pageId,
          limit: 20,
        },
        user,
      ),
    ).resolves.toMatchObject({
      rootAllowed: false,
      items: [{ id: pageId, title: 'Current title' }],
    });
    expect(query.where).toHaveBeenCalledWith('page.id', '=', pageId);
    expect(eb.selectFrom).toHaveBeenCalledWith(
      'pageTemplateInstances as sourceInstance',
    );
  });

  it('hides linked instances from source choices but keeps them as valid destinations', async () => {
    const linkedId = '019fdaa0-0000-7000-8000-000000000071';
    const buildQuery = (rows: unknown[]) => {
      const selectedTables: string[] = [];
      const subquery: any = {};
      for (const method of ['select', 'whereRef', 'where']) {
        subquery[method] = jest.fn(() => subquery);
      }
      const eb: any = jest.fn(() => true);
      eb.not = jest.fn((value) => value);
      eb.exists = jest.fn((value) => value);
      eb.or = jest.fn((values) => values.some(Boolean));
      eb.and = jest.fn((values) => values.every(Boolean));
      eb.selectFrom = jest.fn((table: string) => {
        selectedTables.push(table);
        return subquery;
      });
      const query: any = {};
      for (const method of ['select', 'orderBy', 'limit']) {
        query[method] = jest.fn(() => query);
      }
      query.where = jest.fn((value: unknown) => {
        if (typeof value === 'function') value(eb);
        return query;
      });
      query.execute = jest.fn().mockResolvedValue(rows);
      return { query, selectedTables };
    };
    const sourceQuery = buildQuery([]);
    const destinationQuery = buildQuery([
      {
        id: linkedId,
        updatedAt: new Date('2026-08-14T12:00:00.000Z'),
      },
    ]);
    const queries = [sourceQuery.query, destinationQuery.query];
    const linkedPage = {
      id: linkedId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      slugId: 'linked-slug',
      title: 'Linked instance',
      icon: null,
      parentPageId: null,
      deletedAt: null,
    };
    const pageAccessService = {
      getEffectiveAccessForPages: jest.fn(
        async (pages: Array<{ id: string }>) =>
          new Map(
            pages.map((page) => [
              page.id,
              { capabilities: { canRead: true, canCreateChild: true } },
            ]),
          ),
      ),
    };
    const { instance } = buildService({
      db: { selectFrom: jest.fn(() => queries.shift()) },
      pageRepo: { findById: jest.fn().mockResolvedValue(linkedPage) },
      pageAccessService,
    });

    await expect(
      instance.listDestinations(
        { spaceId: sourceSpaceId, purpose: 'source', limit: 20 },
        user,
      ),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      instance.listDestinations(
        { spaceId: sourceSpaceId, purpose: 'destination', limit: 20 },
        user,
      ),
    ).resolves.toMatchObject({ items: [{ id: linkedId }] });
    expect(sourceQuery.selectedTables).toContain(
      'pageTemplateInstances as sourceInstance',
    );
    expect(destinationQuery.selectedTables).not.toContain(
      'pageTemplateInstances as sourceInstance',
    );
  });

  it('keeps destination pagination stable when a returned page is updated and a new page is inserted', async () => {
    const destinationRows = [3, 2, 1].map((number) => ({
      id: `019fdaa0-0000-7000-8000-00000000007${number}`,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      slugId: `destination-${number}`,
      title: `Destination ${number}`,
      icon: null,
      parentPageId: null,
      deletedAt: null,
      updatedAt: new Date(`2026-08-14T12:0${number}:00.000Z`),
    }));
    const makeQuery = () => {
      const predicates: Array<(eb: any) => boolean> = [];
      let queryLimit = Number.POSITIVE_INFINITY;
      const query: any = {};
      for (const method of ['select', 'orderBy']) {
        query[method] = jest.fn(() => query);
      }
      query.where = jest.fn((value: unknown) => {
        if (typeof value === 'function') {
          predicates.push(value as (eb: any) => boolean);
        }
        return query;
      });
      query.limit = jest.fn((value: number) => {
        queryLimit = value;
        return query;
      });
      query.execute = jest.fn(async () => {
        const subquery: any = {};
        for (const method of ['select', 'whereRef', 'where']) {
          subquery[method] = jest.fn(() => subquery);
        }
        const evaluate = (row: any, predicate: (eb: any) => boolean) => {
          const eb: any = (field: string, operator: string, value: any) => {
            const left = row[field.replace('page.', '')];
            const normalizedLeft = left instanceof Date ? left.getTime() : left;
            const normalizedRight =
              value instanceof Date ? value.getTime() : value;
            if (operator === '<') return normalizedLeft < normalizedRight;
            if (operator === '=') return normalizedLeft === normalizedRight;
            throw new Error(`Unsupported operator ${operator}`);
          };
          eb.or = (values: boolean[]) => values.some(Boolean);
          eb.and = (values: boolean[]) => values.every(Boolean);
          eb.exists = () => false;
          eb.not = (value: boolean) => !value;
          eb.selectFrom = () => subquery;
          return predicate(eb);
        };
        return destinationRows
          .filter((row) =>
            predicates.every((predicate) => evaluate(row, predicate)),
          )
          .sort(
            (left, right) =>
              right.updatedAt.getTime() - left.updatedAt.getTime() ||
              right.id.localeCompare(left.id),
          )
          .slice(0, queryLimit);
      });
      return query;
    };
    const pageAccessService = {
      getEffectiveAccessForPages: jest.fn(
        async (pages: Array<{ id: string }>) =>
          new Map(
            pages.map((page) => [
              page.id,
              { capabilities: { canRead: true, canCreateChild: true } },
            ]),
          ),
      ),
    };
    const pageRepo = {
      findById: jest.fn(async (id: string) =>
        destinationRows.find((row) => row.id === id),
      ),
    };
    const { instance } = buildService({
      db: { selectFrom: jest.fn(() => makeQuery()) },
      pageRepo,
      pageAccessService,
    });

    const first = await instance.listDestinations(
      { spaceId: sourceSpaceId, limit: 2 },
      user,
    );
    expect(first.items.map((item) => item.id)).toEqual([
      '019fdaa0-0000-7000-8000-000000000073',
      '019fdaa0-0000-7000-8000-000000000072',
    ]);
    destinationRows[0].updatedAt = new Date('2026-08-14T12:10:00.000Z');
    destinationRows.unshift({
      id: '019fdaa0-0000-7000-8000-000000000074',
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      slugId: 'destination-4',
      title: 'Destination 4',
      icon: null,
      parentPageId: null,
      deletedAt: null,
      updatedAt: new Date('2026-08-14T12:11:00.000Z'),
    });

    const second = await instance.listDestinations(
      { spaceId: sourceSpaceId, limit: 2, cursor: first.nextCursor! },
      user,
    );
    expect(second.items.map((item) => item.id)).toEqual([
      '019fdaa0-0000-7000-8000-000000000071',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('bounds destination ACL filtering and exposes the next hidden window cursor', async () => {
    const candidateWindow = Array.from({ length: 6 }, (_, index) => ({
      id: `hidden-destination-${index}`,
      updatedAt: new Date(`2026-08-14T12:0${index}:00.000Z`),
    }));
    const query: any = {};
    for (const method of ['select', 'where', 'orderBy', 'offset', 'limit']) {
      query[method] = jest.fn(() => query);
    }
    query.execute = jest.fn().mockResolvedValue(candidateWindow);
    const pageRepo = {
      findById: jest.fn(async (id: string) => ({
        id,
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
        slugId: `${id}-slug`,
        title: id,
        icon: null,
        parentPageId: null,
        deletedAt: null,
      })),
    };
    const pageAccessService = {
      getEffectiveAccessForPages: jest.fn(
        async (pages: Array<{ id: string }>) =>
          new Map(
            pages.map((page) => [
              page.id,
              { capabilities: { canCreateChild: false, canRead: false } },
            ]),
          ),
      ),
    };
    const { instance } = buildService({
      db: { selectFrom: jest.fn(() => query) },
      pageRepo,
      pageAccessService,
    });

    const result = await instance.listDestinations(
      { spaceId: sourceSpaceId, limit: 1 },
      user,
    );
    expect(result.items).toEqual([]);
    expect(
      JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString('utf8')),
    ).toEqual({
      version: 1,
      type: 'page',
      updatedAt: '2026-08-14T12:05:00.000Z',
      id: 'hidden-destination-5',
    });
    expect(query.execute).toHaveBeenCalledTimes(1);
    expect(pageRepo.findById).toHaveBeenCalledTimes(6);
  });
});

describe('PageTemplateService facade', () => {
  it('delegates new capability, restore, and independent-copy operations', async () => {
    const instances = {
      getCapabilities: jest.fn().mockResolvedValue({ capabilities: {} }),
      restore: jest.fn().mockResolvedValue({ archived: false }),
      createIndependentCopy: jest.fn().mockResolvedValue({ idempotent: false }),
    };
    const service = new PageTemplateService(
      instances as any,
      {} as any,
    );
    const copyDto = { title: 'Independent' };

    await service.getCapabilities(sourceSpaceId, user);
    await service.restore(sourcePageId, user);
    await service.createIndependentCopy(
      consumerPageId,
      copyDto,
      'copy-key',
      user,
    );

    expect(instances.getCapabilities).toHaveBeenCalledWith(sourceSpaceId, user);
    expect(instances.restore).toHaveBeenCalledWith(sourcePageId, user);
    expect(instances.createIndependentCopy).toHaveBeenCalledWith(
      consumerPageId,
      copyDto,
      'copy-key',
      user,
    );
  });
});
