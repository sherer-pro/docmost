import { PageEmbedService } from '../page-embed.service';

function buildService(
  edges: Array<{ referencePageId: string; sourcePageId: string }> = [],
  options?: {
    pageRepo?: any;
    pageAccessService?: any;
    policy?: any;
    graphLock?: any;
  },
) {
  const references = {
    findPageGraph: jest.fn(async () => edges),
  };
  const service = new PageEmbedService(
    null as any,
    references as any,
    options?.pageRepo ?? (null as any),
    options?.pageAccessService ?? (null as any),
    options?.policy ?? ({ getMaxPageEmbedDepth: () => 5 } as any),
    options?.graphLock ?? ({} as any),
  );
  return { service, references };
}

describe('PageEmbedService graph validation', () => {
  it('rejects direct self references', async () => {
    const { service } = buildService();
    await expect(
      service.assertGraphValid('workspace', 'page-a', ['page-a']),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'page_embed_self_reference' }),
    });
  });

  it('rejects indirect cycles against the persisted graph', async () => {
    const { service } = buildService([
      { referencePageId: 'page-b', sourcePageId: 'page-c' },
      { referencePageId: 'page-c', sourcePageId: 'page-a' },
    ]);
    await expect(
      service.assertGraphValid('workspace', 'page-a', ['page-b']),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'page_embed_cycle' }),
    });
  });

  it('accepts depth five and rejects depth six', async () => {
    const depthFive = [
      { referencePageId: 'b', sourcePageId: 'c' },
      { referencePageId: 'c', sourcePageId: 'd' },
      { referencePageId: 'd', sourcePageId: 'e' },
      { referencePageId: 'e', sourcePageId: 'f' },
    ];
    await expect(
      buildService(depthFive).service.assertGraphValid('workspace', 'a', ['b']),
    ).resolves.toBeUndefined();

    await expect(
      buildService([
        ...depthFive,
        { referencePageId: 'f', sourcePageId: 'g' },
      ]).service.assertGraphValid('workspace', 'a', ['b']),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'page_embed_depth_exceeded',
      }),
    });
  });

  it('rejects a deep graph without recursive stack growth', async () => {
    const edges = Array.from({ length: 9_000 }, (_, index) => ({
      referencePageId: `page-${index}`,
      sourcePageId: `page-${index + 1}`,
    }));

    await expect(
      buildService(edges).service.assertGraphValid('workspace', 'root', [
        'page-0',
      ]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'page_embed_depth_exceeded',
      }),
    });
  });
});

describe('PageEmbedService space boundaries', () => {
  const workspaceId = '019fdaa0-0000-7000-8000-000000000001';
  const consumerId = '019fdaa0-0000-7000-8000-000000000002';
  const sourceId = '019fdaa0-0000-7000-8000-000000000003';
  const viewer = {
    id: '019fdaa0-0000-7000-8000-000000000004',
    workspaceId,
  } as any;
  const enabledPolicy = {
    systemEnabled: true,
    workspaceEnabled: true,
    templatesEnabled: true,
    allowSyncedTemplate: true,
    allowedActions: ['use_synced_template'],
  };

  it('returns disabled for a historical cross-space embed', async () => {
    const pages = new Map([
      [
        consumerId,
        {
          id: consumerId,
          workspaceId,
          spaceId: 'space-a',
          deletedAt: null,
        },
      ],
      [
        sourceId,
        {
          id: sourceId,
          workspaceId,
          spaceId: 'space-b',
          slugId: 'source',
          title: 'Source',
          icon: null,
          content: { type: 'doc', content: [] },
          updatedAt: new Date(),
          deletedAt: null,
        },
      ],
    ]);
    const pageRepo = { findById: jest.fn(async (id: string) => pages.get(id)) };
    const pageAccessService = {
      getEffectiveAccess: jest.fn(async () => ({
        capabilities: { canRead: true },
      })),
    };
    const policy = {
      getMaxPageEmbedDepth: () => 5,
      resolveForUser: jest.fn(async () => enabledPolicy),
    };
    const { service } = buildService([], {
      pageRepo,
      pageAccessService,
      policy,
    });

    await expect(
      service.lookup([sourceId], viewer, consumerId),
    ).resolves.toEqual({
      items: [{ kind: 'page', sourcePageId: sourceId, status: 'disabled' }],
    });
  });

  it('rejects cross-space references prepared by bulk operations', async () => {
    const pageRepo = {
      findById: jest.fn(async () => ({
        id: sourceId,
        workspaceId,
        spaceId: 'space-b',
        deletedAt: null,
      })),
    };
    const pageAccessService = { assertCanReadPage: jest.fn() };
    const policy = {
      getMaxPageEmbedDepth: () => 5,
      assertAction: jest.fn(),
    };
    const graphLock = { acquire: jest.fn() };
    const { service } = buildService([], {
      pageRepo,
      pageAccessService,
      policy,
      graphLock,
    });

    await expect(
      service.prepareBulkPageReferences(
        [
          {
            id: consumerId,
            workspaceId,
            spaceId: 'space-a',
            content: {
              type: 'doc',
              content: [
                {
                  type: 'pageEmbed',
                  attrs: {
                    id: '019fdaa0-0000-7000-8000-000000000005',
                    sourcePageId: sourceId,
                  },
                },
              ],
            },
          },
        ],
        viewer,
        'import',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'page_embed_cross_space' }),
    });
    expect(graphLock.acquire).not.toHaveBeenCalled();
  });
});
