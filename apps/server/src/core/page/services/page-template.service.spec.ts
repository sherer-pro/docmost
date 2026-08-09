jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { ConflictException, NotFoundException } from '@nestjs/common';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import { PageTemplateService } from './page-template.service';

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
  const service = new PageTemplateService(
    options?.db ?? ({} as any),
    pageRepo,
    pageService,
    pageAccessService,
    spaceAbility,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    policy,
    { getMaxDepth: () => 5 } as any,
    options?.transclusion ?? ({} as any),
    {} as any,
    options?.queueOutbox,
  );
  return {
    service,
    pageRepo,
    pageService,
    pageAccessService,
    spaceAbility,
    policy,
  };
}

describe('PageTemplateService space boundaries', () => {
  it('keeps stable error codes and redacts raw failure messages', () => {
    const { service } = buildService();

    expect(
      (service as any).errorCode(
        new ConflictException({
          code: 'page_template_sync_conflict',
          message: 'The template changed',
        }),
      ),
    ).toBe('page_template_sync_conflict');
    expect(
      (service as any).errorCode(
        new Error(
          'storage failed for /private/G24_CANARY_SECRET/customer.pdf',
        ),
      ),
    ).toBe('page_template_operation_failed');
    expect(
      (service as any).errorCode(
        new Error('duplicate_attachments_partial_failure'),
      ),
    ).toBe('page_template_operation_failed');
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
    const { service } = buildService({ db, queueOutbox });
    jest
      .spyOn(service as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue({ id: sourcePageId });

    await expect(
      service.retrySyncRun(sourcePageId, runId, user),
    ).resolves.toEqual({ accepted: true, runId });

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
    const { service } = buildService({
      db,
      pageRepo: { findById: jest.fn().mockResolvedValue(template) },
      queueOutbox,
    });
    jest
      .spyOn(service as any, 'requireManagedSyncedTemplate')
      .mockResolvedValue(template);
    jest.spyOn(service as any, 'getLiveContent').mockResolvedValue(draft);
    jest
      .spyOn(service as any, 'normalizeDraftForPublication')
      .mockReturnValue(draft);
    jest.spyOn(service as any, 'buildPublishPreflight').mockResolvedValue({
      requiresDestructiveConfirmation: false,
    });
    jest
      .spyOn(service as any, 'serializeRevision')
      .mockReturnValue({ id: revision.id });
    jest
      .spyOn(service as any, 'serializeSyncRun')
      .mockReturnValue({ id: run.id });

    await expect(
      service.publish(
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
    const { service } = buildService({ db, pageRepo, pageAccessService });

    await expect(service.getProvenance(consumerPageId, user)).resolves.toEqual({
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
    });
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
    const { service } = buildService({ db, pageRepo, pageAccessService });

    await expect(service.getProvenance(consumerPageId, user)).resolves.toEqual({
      createdFromTemplate: true,
      kind: 'regular',
      status: 'snapshot',
      appliedRevision: null,
      latestRevision: null,
      canReadTemplate: false,
      canDetach: false,
      sourceTemplate: null,
    });
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
    const { service } = buildService({ policy });

    await expect(
      service.discover({ spaceId: sourceSpaceId, limit: 20 }, user),
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
    const { service, policy } = buildService();
    jest
      .spyOn(service as any, 'findCompletedOperation')
      .mockResolvedValue(null);
    jest.spyOn(service as any, 'requireTemplateSource').mockResolvedValue({
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      templateKind: 'regular',
    });

    await expect(
      service.createFromTemplate(
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
    const { service } = buildService({ pageRepo });
    jest
      .spyOn(service as any, 'canMaterializeLegacySource')
      .mockResolvedValue(true);
    jest.spyOn(service as any, 'getLiveContent').mockResolvedValue({
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

    const result = await (service as any).resolveLegacyPageEmbeds(
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
    const { service } = buildService({
      pageRepo: { findById: jest.fn(async () => null) },
    });
    const result = await (service as any).resolveLegacyPageEmbeds(
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
    const { service } = buildService({ pageRepo });

    const result = await (service as any).resolveLegacyPageEmbeds(
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
    const { service } = buildService({
      pageRepo: { findById: jest.fn(async () => source) },
      pageAccessService,
    });
    const getLiveContent = jest.spyOn(service as any, 'getLiveContent');

    const result = await (service as any).resolveLegacyPageEmbeds(
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
    const { service } = buildService({
      pageRepo: { findById: jest.fn(async () => source) },
    });
    jest
      .spyOn(service as any, 'canMaterializeLegacySource')
      .mockResolvedValue(false);
    const getLiveContent = jest
      .spyOn(service as any, 'getLiveContent')
      .mockResolvedValue(restrictedContent);

    const result = await (service as any).resolveLegacyPageEmbeds(
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
    const { service } = buildService();
    jest
      .spyOn(service as any, 'findLegacyPageEmbedCandidates')
      .mockResolvedValueOnce([{ referencePageId: consumerPageId }])
      .mockResolvedValueOnce([{ referencePageId: consumerPageId }]);
    jest
      .spyOn(service as any, 'migrateLegacyPageEmbedsForPage')
      .mockResolvedValue(false);

    await expect((service as any).migrateLegacyPageEmbeds()).rejects.toThrow(
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
    const { service } = buildService({ db });
    jest.spyOn(service as any, 'getLiveContent').mockResolvedValue(previous);

    const result = await (service as any).buildPublishPreflight(
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
    const { service } = buildService({ db, pageRepo, pageAccessService });

    await expect(
      service.listDestinations({ spaceId: sourceSpaceId, limit: 20 }, user),
    ).resolves.toMatchObject({
      rootAllowed: true,
      items: [{ id: 'allowed' }],
    });
  });
});
