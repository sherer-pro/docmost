jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { ConflictException, NotFoundException } from '@nestjs/common';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import { PageTemplateService } from './page-template.service';
import { PageTemplateRuntimeService } from './page-template-runtime.service';
import { PageTemplateContentService } from './page-template-content.service';
import { PageTemplateOperationService } from './page-template-operation.service';
import { PageTemplatePublicationService } from './page-template-publication.service';
import { PageTemplateInstanceService } from './page-template-instance.service';
import { PageTemplateSyncService } from './page-template-sync.service';
import { PageEmbedCommandService } from './page-embed-command.service';
import { LegacyPageEmbedMigrationService } from './legacy-page-embed-migration.service';

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
  const pageService = options?.pageService ?? { create: jest.fn() };
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
  const pageEmbedService = { getMaxDepth: () => 5 } as any;
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
    pageEmbedService,
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
  const pageEmbeds = new PageEmbedCommandService(
    pageAccessService,
    policy,
    pageEmbedService,
    attachmentRepo,
    storageService,
    content,
    operations,
  );
  const legacy = new LegacyPageEmbedMigrationService(
    db,
    pageRepo,
    pageAccessService,
    pageEmbedService,
    pageHistoryRecorder,
    attachmentRepo,
    storageService,
    content,
    operations,
  );
  const service = new PageTemplateService(instance, sync, pageEmbeds);
  return {
    service,
    instance,
    sync,
    legacy,
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
  });

  it('persists a retry dispatch in the run transaction before signaling the queue', async () => {
    const runId = '019fdaa0-0000-7000-8000-000000000099';
    const runQuery: Record<string, jest.Mock> = {};
    for (const method of ['selectAll', 'where']) {
      runQuery[method] = jest.fn(() => runQuery);
    }
    runQuery.executeTakeFirst = jest.fn().mockResolvedValue({
      id: runId,
      templatePageId: sourcePageId,
    });
    const updateQuery = () => {
      const query: Record<string, jest.Mock> = {};
      query.set = jest.fn(() => query);
      query.where = jest.fn(() => query);
      query.execute = jest.fn().mockResolvedValue(undefined);
      return query;
    };
    const trx = { updateTable: jest.fn(() => updateQuery()) };
    let transactionCommitted = false;
    const db = {
      selectFrom: jest.fn(() => runQuery),
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
  });

  it('commits a published revision and its dispatch before signaling the queue', async () => {
    const draft = { type: 'doc', content: [{ type: 'paragraph' }] };
    const template = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      templateKind: 'synced',
      templateArchivedAt: null,
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
      for (const method of ['select', 'where']) {
        query[method] = jest.fn(() => query);
      }
      query.executeTakeFirst = jest.fn().mockResolvedValue(result);
      query.execute = jest.fn().mockResolvedValue(many ? result : []);
      return query;
    };
    const insertQuery = (result?: unknown) => {
      const query: Record<string, jest.Mock> = {};
      query.values = jest.fn(() => query);
      query.returningAll = jest.fn(() => query);
      query.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(result);
      query.execute = jest.fn().mockResolvedValue(undefined);
      return query;
    };
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
        if (table === 'pageTemplateRevisions') return insertQuery(revision);
        if (table === 'pageTemplateSyncRuns') return insertQuery(run);
        return insertQuery();
      }),
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
    const { sync, content, publication } = buildService({
      db,
      pageRepo: { findById: jest.fn().mockResolvedValue(template) },
      queueOutbox,
    });
    jest
      .spyOn(sync as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue(template);
    jest.spyOn(content, 'getLiveContent').mockResolvedValue(draft);
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
        user,
      ),
    ).resolves.toEqual({
      revision: { id: revision.id },
      syncRun: { id: run.id },
    });

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
        canReadTemplate: true,
        canDetach: false,
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
        canReadTemplate: false,
        canDetach: false,
        sourceTemplate: null,
      },
    );
    expect(pageAccessService.getEffectiveAccess).toHaveBeenCalledTimes(1);
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

  it('materializes legacy page embeds and plans attachment copies', async () => {
    const source = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
      content: null,
    };
    const pageRepo = { findById: jest.fn(async () => source) };
    const { legacy, content } = buildService({ pageRepo });
    jest
      .spyOn(legacy as any, 'canMaterializeLegacySource')
      .mockResolvedValue(true);
    jest.spyOn(content, 'getLiveContent').mockResolvedValue({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Materialized' }],
        },
        {
          type: 'image',
          attrs: {
            attachmentId: '019fdaa0-0000-7000-8000-000000000070',
            src: '/api/files/019fdaa0-0000-7000-8000-000000000070/image.png',
          },
        },
      ],
    });

    const result = await (legacy as any).resolveLegacyPageEmbeds(
      {
        type: 'doc',
        content: [
          {
            type: 'pageEmbed',
            attrs: {
              id: '019fdaa0-0000-7000-8000-000000000080',
              sourcePageId,
            },
          },
        ],
      },
      {
        id: consumerPageId,
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
      },
      user,
      new Set([consumerPageId]),
      [],
    );

    expect(JSON.stringify(result.content)).not.toContain('pageEmbed');
    expect(JSON.stringify(result.content)).toContain('Materialized');
    expect(result.attachmentPlans).toHaveLength(1);
    expect(result.attachmentPlans[0].source.id).toBe(sourcePageId);
    expect(result.issues).toEqual([]);
  });

  it('replaces an unavailable legacy source with an informational block', async () => {
    const { legacy, content } = buildService({
      pageRepo: { findById: jest.fn(async () => null) },
    });
    const result = await (legacy as any).resolveLegacyPageEmbeds(
      {
        type: 'doc',
        content: [
          {
            type: 'pageEmbed',
            attrs: {
              id: 'legacy-node',
              sourcePageId,
            },
          },
        ],
      },
      {
        id: consumerPageId,
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
      },
      user,
      new Set([consumerPageId]),
      [],
    );

    expect(result.content.content[0].type).toBe('callout');
    expect(result.issues).toEqual([
      {
        referenceNodeId: 'legacy-node',
        sourcePageId,
        errorCode: 'page_embed_source_unavailable',
      },
    ]);
  });

  it('replaces legacy embeds beyond the configured depth without loading the source', async () => {
    const pageRepo = { findById: jest.fn() };
    const { legacy } = buildService({ pageRepo });

    const result = await (legacy as any).resolveLegacyPageEmbeds(
      {
        type: 'doc',
        content: [
          {
            type: 'pageEmbed',
            attrs: { id: 'too-deep', sourcePageId },
          },
        ],
      },
      {
        id: consumerPageId,
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
      },
      user,
      new Set([
        consumerPageId,
        'depth-1',
        'depth-2',
        'depth-3',
        'depth-4',
        'depth-5',
      ]),
      [],
    );

    expect(result.content.content[0].type).toBe('callout');
    expect(result.issues).toEqual([
      {
        referenceNodeId: 'too-deep',
        sourcePageId,
        errorCode: 'page_embed_depth_exceeded',
      },
    ]);
    expect(pageRepo.findById).not.toHaveBeenCalled();
  });

  it('does not materialize a legacy source the migration actor cannot read', async () => {
    const source = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Restricted content' }],
          },
        ],
      },
    };
    const pageAccessService = {
      getEffectiveAccess: jest.fn(async () => ({
        capabilities: { canRead: false },
      })),
    };
    const { legacy, content } = buildService({
      pageRepo: { findById: jest.fn(async () => source) },
      pageAccessService,
    });
    const getLiveContent = jest.spyOn(content, 'getLiveContent');

    const result = await (legacy as any).resolveLegacyPageEmbeds(
      {
        type: 'doc',
        content: [
          {
            type: 'pageEmbed',
            attrs: { id: 'legacy-node', sourcePageId },
          },
        ],
      },
      {
        id: consumerPageId,
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
      },
      user,
      new Set([consumerPageId]),
      [],
    );

    expect(JSON.stringify(result.content)).not.toContain('Restricted content');
    expect(result.content.content[0].type).toBe('callout');
    expect(result.issues).toEqual([
      {
        referenceNodeId: 'legacy-node',
        sourcePageId,
        errorCode: 'page_embed_source_no_access',
      },
    ]);
    expect(pageAccessService.getEffectiveAccess).toHaveBeenCalledWith(
      source,
      user,
    );
    expect(getLiveContent).not.toHaveBeenCalled();
  });

  it('does not materialize legacy content for a broader consumer audience', async () => {
    const restrictedContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Restricted content' }],
        },
      ],
    };
    const source = {
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      deletedAt: null,
      content: restrictedContent,
    };
    const { legacy, content } = buildService({
      pageRepo: { findById: jest.fn(async () => source) },
    });
    jest
      .spyOn(legacy as any, 'canMaterializeLegacySource')
      .mockResolvedValue(false);
    const getLiveContent = jest
      .spyOn(content, 'getLiveContent')
      .mockResolvedValue(restrictedContent);

    const result = await (legacy as any).resolveLegacyPageEmbeds(
      {
        type: 'doc',
        content: [
          {
            type: 'pageEmbed',
            attrs: { id: 'legacy-node', sourcePageId },
          },
        ],
      },
      {
        id: consumerPageId,
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
      },
      user,
      new Set([consumerPageId]),
      [],
    );

    expect(JSON.stringify(result.content)).not.toContain('Restricted content');
    expect(result.content.content[0].type).toBe('callout');
    expect(result.issues).toEqual([
      {
        referenceNodeId: 'legacy-node',
        sourcePageId,
        errorCode: 'page_embed_source_audience_mismatch',
      },
    ]);
    expect(getLiveContent).not.toHaveBeenCalled();
  });

  it('fails startup when legacy page embeds remain after migration', async () => {
    const { legacy, sync, operations, pageRepo } = buildService();
    jest
      .spyOn(legacy as any, 'findLegacyPageEmbedCandidates')
      .mockResolvedValueOnce([{ referencePageId: consumerPageId }])
      .mockResolvedValueOnce([{ referencePageId: consumerPageId }]);
    jest
      .spyOn(legacy as any, 'migrateLegacyPageEmbedsForPage')
      .mockResolvedValue(false);

    const runtime = new PageTemplateRuntimeService(
      {} as any,
      pageRepo,
      legacy,
      sync,
      operations,
    );
    await expect((runtime as any).migrateLegacyPageEmbeds()).rejects.toThrow(
      'legacy_page_embed_migration_incomplete',
    );
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
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.executeTakeFirst = jest.fn(async () =>
        table === 'pageTemplateRevisions'
          ? { revision: 1, content: previous }
          : undefined,
      );
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

  it('returns only destinations where child creation is allowed', async () => {
    const query: any = {};
    for (const method of ['select', 'where', 'orderBy', 'limit']) {
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
            ['allowed', { capabilities: { canCreateChild: true } }],
            ['denied', { capabilities: { canCreateChild: false } }],
          ]),
      ),
    };
    const { instance } = buildService({ db, pageRepo, pageAccessService });

    await expect(
      instance.listDestinations({ spaceId: sourceSpaceId, limit: 20 }, user),
    ).resolves.toMatchObject({
      rootAllowed: true,
      items: [{ id: 'allowed' }],
    });
  });
});
