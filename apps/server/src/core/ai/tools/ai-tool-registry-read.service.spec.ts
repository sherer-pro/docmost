jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
// Schema/Yjs normalization is exercised by collaboration.ai-schema.spec.ts.
jest.mock('../../../collaboration/collaboration.util', () => ({
  ...jest.requireActual('../../../collaboration/collaboration.util'),
  strictJsonToNode: (content: unknown) => content,
  prosemirrorNodeToYJson: (content: unknown) => content,
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiToolRegistryService } from './ai-tool-registry.service';

const PAGE = {
  id: 'page-1',
  workspaceId: 'workspace-1',
  spaceId: 'space-1',
  slugId: 'page-slug',
  title: 'Page',
  deletedAt: null,
  templateKind: 'regular',
  content: { type: 'doc', content: [] },
};

const CONTEXT = {
  user: { id: 'user-1', role: 'member' },
  workspaceId: 'workspace-1',
  spaceId: 'space-1',
  source: 'agent',
} as any;

function query(result: unknown, whereCalls: unknown[][]) {
  let rowLimit: number | undefined;
  const value: any = {
    select: jest.fn(() => value),
    selectAll: jest.fn(() => value),
    innerJoin: jest.fn(() => value),
    leftJoin: jest.fn(() => value),
    where: jest.fn((...args) => {
      whereCalls.push(args);
      return value;
    }),
    orderBy: jest.fn(() => value),
    offset: jest.fn(() => value),
    limit: jest.fn((limit: number) => {
      rowLimit = limit;
      return value;
    }),
    execute: jest.fn(async () =>
      Array.isArray(result) && rowLimit !== undefined
        ? result.slice(0, rowLimit)
        : result,
    ),
    executeTakeFirst: jest.fn(async () =>
      Array.isArray(result) ? result[0] : result,
    ),
    executeTakeFirstOrThrow: jest.fn(async () => {
      const first = Array.isArray(result) ? result[0] : result;
      if (typeof first === 'undefined' || first === null) {
        throw new Error('Expected query result');
      }
      return first;
    }),
  };
  return value;
}

function buildRegistry(options?: {
  page?: any;
  excluded?: boolean;
  excludedPageIds?: string[];
  readablePageIds?: string[];
  rows?: Record<string, unknown>;
  share?: any;
  sharingAllowed?: boolean;
  spaceRoles?: Array<{ role: 'admin' | 'writer' | 'reader' }>;
  pageAccessDenied?: boolean;
  liveContent?: any;
  liveError?: boolean;
  searchItems?: any[];
  dictionaryTerms?: any[];
}) {
  const whereCalls: Record<string, unknown[][]> = {};
  const rows = options?.rows ?? {};
  const db = {
    selectFrom: jest.fn((table: string) => {
      whereCalls[table] ??= [];
      return query(rows[table] ?? [], whereCalls[table]);
    }),
  };
  const pageAccess = {
    assertCanReadPage: jest.fn(async () => {
      if (options?.pageAccessDenied) throw new ForbiddenException();
    }),
    assertCanWritePage: jest.fn(async () => undefined),
    getSidebarAccessSnapshot: jest.fn(async () => ({
      readablePageIds: new Set(options?.readablePageIds ?? []),
    })),
  };
  const contentPolicy = {
    isPageExcluded: jest.fn(async () => options?.excluded ?? false),
    getExcludedPageIds: jest.fn(
      async () => new Set(options?.excludedPageIds ?? []),
    ),
  };
  const pages = {
    findById: jest.fn(async () => options?.page ?? PAGE),
  };
  const search = {
    searchPage: jest.fn(async () => ({ items: options?.searchItems ?? [] })),
  };
  const knowledgeProjection = options?.dictionaryTerms
    ? {
        searchDictionaryTerms: jest.fn(async () => options.dictionaryTerms),
        getDocumentFieldsConfig: jest.fn(() => ({
          status: false,
          assignee: false,
          stakeholders: false,
          aiRole: false,
        })),
        buildCustomFields: jest.fn(() => undefined),
        resolveMembers: jest.fn(async () => new Map()),
        memberNames: jest.fn(() => new Map()),
        renderDocumentFields: jest.fn(() => ''),
      }
    : undefined;
  const registry = new AiToolRegistryService(
    db as any,
    pageAccess as any,
    search as any,
    contentPolicy as any,
    pages as any,
    {
      getPageContent: jest.fn(async () => {
        if (options?.liveError) throw new Error('collaboration unavailable');
        return options?.liveContent ?? { type: 'doc', content: [] };
      }),
    } as any,
    {
      getShareForPage: jest.fn(async () => options?.share),
      isSharingAllowed: jest.fn(async () => options?.sharingAllowed ?? true),
    } as any,
    {
      getAppUrl: () => 'https://docs.example.com/',
    } as any,
    {
      createForUser: jest.fn(async () => ({ can: () => true })),
    } as any,
    {
      resolveForUser: jest.fn(async () => ({
        systemEnabled: true,
        workspaceEnabled: true,
        templatesEnabled: true,
        allowedActions: ['use_regular_template', 'use_synced_template'],
      })),
    } as any,
    {
      getUserSpaceRoles: jest.fn(async () => options?.spaceRoles ?? []),
    } as any,
    knowledgeProjection as any,
  );
  return { registry, db, pageAccess, contentPolicy, whereCalls };
}

describe('extended built-in AI read tools', () => {
  it('prioritizes exact dictionary matches within the shared search limit', async () => {
    const { registry } = buildRegistry({
      rows: {
        spaces: [
          {
            id: CONTEXT.spaceId,
            workspaceId: CONTEXT.workspaceId,
            slug: 'space',
            settings: { dictionary: { enabled: true } },
          },
        ],
        pages: [
          {
            id: 'page-1',
            title: 'Page one',
            slugId: 'page-one',
            settings: {},
          },
          {
            id: 'page-2',
            title: 'Page two',
            slugId: 'page-two',
            settings: {},
          },
        ],
      },
      searchItems: [
        {
          id: 'page-1',
          title: 'Page one',
          slugId: 'page-one',
          breadcrumbs: [],
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 'page-2',
          title: 'Page two',
          slugId: 'page-two',
          breadcrumbs: [],
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
      dictionaryTerms: [
        {
          id: 'term-exact',
          term: 'Exact',
          forms: ['Exact form'],
          definitionMarkdown: 'Exact definition',
          score: 1000,
          exact: true,
        },
        {
          id: 'term-partial',
          term: 'Partial',
          forms: [],
          definitionMarkdown: 'Partial definition',
          score: 500,
          exact: false,
        },
      ],
    });

    const result = await registry.execute(
      'search',
      { query: 'Exact', limit: 2 },
      CONTEXT,
    );

    expect((result.content as any).items).toHaveLength(2);
    expect((result.content as any).items[0]).toMatchObject({
      type: 'dictionary_term',
      sourceId: 'term-exact',
      pageId: null,
      deepLink: '/s/space/dictionary?term=term-exact',
    });
    expect((result.content as any).items[1]).toMatchObject({
      type: 'page',
      pageId: 'page-1',
    });
    expect(result.citations).toContainEqual(
      expect.objectContaining({
        sourceType: 'dictionary_term',
        sourceId: 'term-exact',
        pageId: null,
      }),
    );
  });

  it('binds #index proposals to the exact live outline hash', async () => {
    const liveContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'stable-paragraph' },
          content: [{ type: 'text', text: 'Before' }],
        },
      ],
    };
    const { registry } = buildRegistry({
      liveContent,
      rows: { spaces: [{ slug: 'space' }] },
    });
    const context = { ...CONTEXT, currentPageId: PAGE.id };
    const outline = await registry.execute(
      'getOutline',
      { pageId: PAGE.id },
      context,
    );
    const contentHash = (outline.content as any).contentHash;

    await expect(
      registry.execute(
        'editPageText',
        {
          nodeId: '#0',
          oldText: 'Before',
          newText: 'After',
          outlineContentHash: contentHash,
        },
        context,
      ),
    ).resolves.toMatchObject({
      content: { status: 'pending_user_approval' },
      writeProposal: { baseContentHash: contentHash },
    });

    await expect(
      registry.execute(
        'editPageText',
        {
          nodeId: '#0',
          oldText: 'Before',
          newText: 'After',
          outlineContentHash: '0'.repeat(64),
        },
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks a template list truncated when another readable row exists', async () => {
    const templates = [
      {
        ...PAGE,
        id: 'template-1',
        updatedAt: new Date('2026-08-04T02:00:00Z'),
      },
      {
        ...PAGE,
        id: 'template-2',
        updatedAt: new Date('2026-08-04T01:00:00Z'),
      },
    ];
    const { registry } = buildRegistry({
      readablePageIds: templates.map((page) => page.id),
      rows: {
        'pages as page': templates,
        pages: templates,
        spaces: [{ slug: 'space' }],
      },
    });

    const result = await registry.execute(
      'listPageTemplates',
      { limit: 1 },
      CONTEXT,
    );

    expect(result.content).toMatchObject({
      items: [expect.objectContaining({ id: 'template-1' })],
      truncated: true,
    });
  });

  it('counts all readable same-space template usages beyond 150 rows', async () => {
    const usages = Array.from({ length: 200 }, (_, index) => ({
      id: `consumer-${index}`,
      title: `Consumer ${index}`,
      slugId: `consumer-${index}`,
      icon: null,
      updatedAt: new Date(2026, 7, 4, 0, 0, 0, 200 - index),
      instanceKind: 'synced',
      status: 'active',
      appliedRevision: 1,
    }));
    const { registry } = buildRegistry({
      readablePageIds: usages.map((page) => page.id),
      rows: {
        'pageTemplateInstances as instance': usages,
        pages: [PAGE, ...usages],
        spaces: [{ slug: 'space' }],
      },
    });

    const result = await registry.execute(
      'listPageTemplateUsages',
      { pageId: PAGE.id, limit: 20 },
      CONTEXT,
    );

    expect(result.content).toMatchObject({
      occurrenceCount: 200,
      truncated: true,
    });
  });
  it('fails closed for a page outside the execution workspace', async () => {
    const { registry, pageAccess } = buildRegistry({
      page: { ...PAGE, workspaceId: 'workspace-2' },
    });

    await expect(
      registry.execute('listPageAttachments', { pageId: PAGE.id }, CONTEXT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pageAccess.assertCanReadPage).not.toHaveBeenCalled();
  });

  it('applies the shared AI exclusion policy before reading page children', async () => {
    const { registry } = buildRegistry({ excluded: true });

    await expect(
      registry.execute('listComments', { pageId: PAGE.id }, CONTEXT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a readable-page tool across the execution space boundary', async () => {
    const { registry } = buildRegistry({
      page: { ...PAGE, spaceId: 'space-2' },
    });

    await expect(
      registry.execute('listComments', { pageId: PAGE.id }, CONTEXT),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('curates database schema and cites the database root page', async () => {
    const { registry } = buildRegistry({
      rows: {
        databases: [
          {
            id: 'database-1',
            name: 'Projects',
            description: 'Project tracker',
            icon: null,
            pageId: PAGE.id,
            workspaceId: CONTEXT.workspaceId,
            spaceId: CONTEXT.spaceId,
          },
        ],
        databaseProperties: [
          {
            id: 'property-1',
            name: 'Status',
            type: 'select',
            position: 0,
            settings: {
              options: [{ label: 'Open', value: 'open', color: 'blue' }],
              providerSecret: 'must-not-leak',
            },
          },
        ],
        databaseViews: [{ id: 'view-1', name: 'Table', type: 'table' }],
        pages: [PAGE],
        spaces: [{ slug: 'space' }],
      },
    });

    const result = await registry.execute(
      'getDatabaseContext',
      { databaseId: 'database-1' },
      CONTEXT,
    );
    const content = result.content as any;

    expect(content.database).not.toHaveProperty('workspaceId');
    expect(content.properties[0].settings).toEqual({
      options: [{ label: 'Open', value: 'open', color: 'blue' }],
    });
    expect(content.properties[0].settings).not.toHaveProperty('providerSecret');
    expect(result.citations).toEqual([
      expect.objectContaining({ pageId: PAGE.id, sourceType: 'page' }),
    ]);
  });

  it('requires access to the database root before returning database data', async () => {
    const { registry } = buildRegistry({
      pageAccessDenied: true,
      rows: {
        databases: [
          {
            id: 'database-1',
            pageId: PAGE.id,
            workspaceId: CONTEXT.workspaceId,
            spaceId: CONTEXT.spaceId,
          },
        ],
      },
    });

    await expect(
      registry.execute(
        'getDatabaseContext',
        { databaseId: 'database-1' },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns only safe attachment metadata and bounded pagination', async () => {
    const attachments = Array.from({ length: 51 }, (_, index) => ({
      id: `attachment-${index}`,
      fileName: `file-${index}.pdf`,
      mimeType: 'application/pdf',
      fileSize: BigInt(100 + index),
      fileExt: 'pdf',
      type: 'file',
      createdAt: new Date('2026-08-04T00:00:00.000Z'),
      updatedAt: new Date('2026-08-04T00:00:00.000Z'),
      contentIndexStatus: 'completed',
      contentIndexedAt: new Date('2026-08-04T00:00:00.000Z'),
    }));
    const { registry, whereCalls } = buildRegistry({
      rows: {
        attachments,
        spaces: [{ slug: 'space' }],
      },
    });

    const result = await registry.execute(
      'listPageAttachments',
      { pageId: PAGE.id, limit: 50 },
      CONTEXT,
    );
    const content = result.content as any;

    expect(content.items.length).toBeGreaterThan(0);
    expect(content.items.length).toBeLessThanOrEqual(50);
    expect(content.truncated).toBe(true);
    expect(content.nextCursor).toEqual(expect.any(String));
    expect(content.items[0]).not.toHaveProperty('filePath');
    expect(content.items[0]).not.toHaveProperty('textContent');
    expect(content.items[0]).not.toHaveProperty('data');
    expect(content.items[0].fileSize).toBe('100');
    expect(whereCalls.attachments).toEqual(
      expect.arrayContaining([
        ['pageId', '=', PAGE.id],
        ['workspaceId', '=', CONTEXT.workspaceId],
        ['spaceId', '=', CONTEXT.spaceId],
        ['deletedAt', 'is', null],
      ]),
    );
  });

  it('advances a database cursor past filtered rows without repeating them', async () => {
    const databaseRows = [
      {
        id: 'row-1',
        pageId: 'row-page-1',
        title: 'Hidden row',
        slugId: 'hidden-row',
        updatedAt: new Date('2026-08-04T03:00:00.000Z'),
      },
      {
        id: 'row-2',
        pageId: 'row-page-2',
        title: 'Readable row',
        slugId: 'readable-row',
        updatedAt: new Date('2026-08-04T02:00:00.000Z'),
      },
      {
        id: 'row-3',
        pageId: 'row-page-3',
        title: 'Next row',
        slugId: 'next-row',
        updatedAt: new Date('2026-08-04T01:00:00.000Z'),
      },
    ];
    const { registry } = buildRegistry({
      readablePageIds: ['row-page-2'],
      rows: {
        databases: [
          {
            id: 'database-1',
            pageId: PAGE.id,
            workspaceId: CONTEXT.workspaceId,
            spaceId: CONTEXT.spaceId,
          },
        ],
        'databaseRows as row': databaseRows,
        databaseRows,
        databaseCells: [],
        pages: [
          PAGE,
          ...databaseRows.map((row) => ({
            id: row.pageId,
            title: row.title,
            slugId: row.slugId,
          })),
        ],
        spaces: [{ slug: 'space' }],
      },
    });

    const result = await registry.execute(
      'listDatabaseRows',
      { databaseId: 'database-1', limit: 2 },
      CONTEXT,
    );
    const content = result.content as any;

    expect(content.items.map((row: any) => row.pageId)).toEqual(['row-page-2']);
    expect(
      JSON.parse(Buffer.from(content.nextCursor, 'base64url').toString('utf8')),
    ).toEqual({
      version: 1,
      tool: 'listDatabaseRows',
      resourceId: 'database-1',
      sortAt: '2026-08-04T02:00:00.000Z',
      id: 'row-2',
    });
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pageId: PAGE.id, sourceType: 'page' }),
        expect.objectContaining({
          pageId: 'row-page-2',
          sourceType: 'database_row',
        }),
      ]),
    );
  });

  it('filters transclusion references and advances across raw candidates', async () => {
    const references = [
      {
        id: 'ref-1',
        title: 'Hidden',
        slugId: 'hidden',
        updatedAt: new Date('2026-08-04T03:00:00.000Z'),
      },
      {
        id: 'ref-2',
        title: 'Readable',
        slugId: 'readable',
        updatedAt: new Date('2026-08-04T02:00:00.000Z'),
      },
      {
        id: 'ref-3',
        title: 'Next',
        slugId: 'next',
        updatedAt: new Date('2026-08-04T01:00:00.000Z'),
      },
    ];
    const { registry, whereCalls } = buildRegistry({
      readablePageIds: ['ref-2'],
      excludedPageIds: ['ref-1'],
      rows: {
        'pageTransclusionReferences as reference': references,
        pages: [PAGE, ...references],
        spaces: [{ slug: 'space' }],
      },
    });

    const result = await registry.execute(
      'listTransclusionReferences',
      {
        sourcePageId: PAGE.id,
        transclusionId: 'transclusion-1',
        limit: 2,
      },
      CONTEXT,
    );
    const content = result.content as any;

    expect(content.items.map((page: any) => page.id)).toEqual(['ref-2']);
    expect(
      JSON.parse(Buffer.from(content.nextCursor, 'base64url').toString('utf8')),
    ).toEqual({
      version: 1,
      tool: 'listTransclusionReferences',
      resourceId: `${PAGE.id}:transclusion-1`,
      sortAt: '2026-08-04T02:00:00.000Z',
      id: 'ref-2',
    });
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pageId: PAGE.id }),
        expect.objectContaining({ pageId: 'ref-2' }),
      ]),
    );
    expect(whereCalls['pageTransclusionReferences as reference']).toEqual(
      expect.arrayContaining([
        ['reference.workspaceId', '=', CONTEXT.workspaceId],
        ['page.spaceId', '=', CONTEXT.spaceId],
        ['page.deletedAt', 'is', null],
      ]),
    );
  });

  it('returns compact comment threads with safe actor fields', async () => {
    const { registry, whereCalls } = buildRegistry({
      rows: {
        'comments as comment': [
          {
            id: 'comment-1',
            parentCommentId: null,
            type: 'inline',
            selection: 'selected text',
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Review this sentence' }],
                },
              ],
            },
            createdAt: new Date('2026-08-04T02:00:00.000Z'),
            updatedAt: new Date('2026-08-04T02:00:00.000Z'),
            editedAt: null,
            resolvedAt: new Date('2026-08-04T03:00:00.000Z'),
            creatorId: 'user-2',
            creatorName: 'Reviewer',
            creatorAvatarUrl: null,
            resolvedById: 'user-3',
            resolvedByName: 'Resolver',
          },
        ],
        spaces: [{ slug: 'space' }],
      },
    });

    const result = await registry.execute(
      'listComments',
      { pageId: PAGE.id },
      CONTEXT,
    );
    const comment = (result.content as any).items[0];

    expect(comment).toMatchObject({
      id: 'comment-1',
      content: 'Review this sentence',
      resolvedByName: 'Resolver',
    });
    expect(comment).not.toHaveProperty('creatorEmail');
    expect(whereCalls['comments as comment']).toEqual(
      expect.arrayContaining([['comment.deletedAt', 'is', null]]),
    );
  });

  it('fails closed when live collaboration is unavailable for a history diff', async () => {
    const { registry } = buildRegistry({
      liveError: true,
      rows: {
        pageHistory: [
          {
            id: 'history-1',
            pageId: PAGE.id,
            workspaceId: CONTEXT.workspaceId,
            spaceId: CONTEXT.spaceId,
            content: { type: 'doc', content: [] },
            createdAt: new Date('2026-08-04T00:00:00.000Z'),
          },
        ],
      },
    });

    await expect(
      registry.execute(
        'diffPageVersion',
        { pageId: PAGE.id, historyId: 'history-1' },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('distinguishes inherited and direct public shares without exposing rows', async () => {
    const { registry } = buildRegistry({
      rows: { spaces: [{ slug: 'space' }] },
      share: {
        key: 'public-key',
        pageId: 'ancestor-page',
        includeSubPages: true,
        searchIndexing: false,
        level: 2,
      },
    });

    const result = await registry.execute(
      'getPublicShareInfo',
      { pageId: PAGE.id },
      CONTEXT,
    );

    expect(result.content).toEqual({
      pageId: PAGE.id,
      isPublic: true,
      inherited: true,
      sharedFromPageId: 'ancestor-page',
      includeSubPages: true,
      searchIndexing: false,
      publicUrl: 'https://docs.example.com/share/public-key/p/page-slug',
    });
  });

  it('reports public sharing as disabled before inspecting stored shares', async () => {
    const { registry } = buildRegistry({
      rows: { spaces: [{ slug: 'space' }] },
      sharingAllowed: false,
      share: { key: 'must-not-be-returned', level: 0 },
    });

    const result = await registry.execute(
      'getPublicShareInfo',
      { pageId: PAGE.id },
      CONTEXT,
    );

    expect(result.content).toEqual({
      pageId: PAGE.id,
      isPublic: false,
      disabled: true,
    });
  });

  it.each([
    {
      title: 'direct',
      share: {
        key: 'direct-key',
        pageId: PAGE.id,
        includeSubPages: false,
        searchIndexing: true,
        level: 0,
      },
      expected: { isPublic: true, inherited: false },
    },
    {
      title: 'unshared',
      share: undefined,
      expected: { isPublic: false },
    },
  ])('reports $title public sharing state', async ({ share, expected }) => {
    const { registry } = buildRegistry({
      rows: { spaces: [{ slug: 'space' }] },
      share,
    });

    const result = await registry.execute(
      'getPublicShareInfo',
      { pageId: PAGE.id },
      CONTEXT,
    );

    expect(result.content).toMatchObject({ pageId: PAGE.id, ...expected });
  });

  it('binds pagination cursors to the originating tool and resource', async () => {
    const { registry } = buildRegistry({
      rows: {
        attachments: Array.from({ length: 2 }, (_, index) => ({
          id: `attachment-${index}`,
          fileName: `file-${index}.pdf`,
          mimeType: 'application/pdf',
          fileSize: BigInt(100),
          fileExt: 'pdf',
          type: 'file',
          createdAt: new Date(`2026-08-04T0${2 - index}:00:00.000Z`),
          updatedAt: new Date('2026-08-04T00:00:00.000Z'),
          contentIndexStatus: 'completed',
          contentIndexedAt: null,
        })),
        spaces: [{ slug: 'space' }],
      },
    });
    const first = await registry.execute(
      'listPageAttachments',
      { pageId: PAGE.id, limit: 1 },
      CONTEXT,
    );
    const cursor = (first.content as any).nextCursor;

    await expect(
      registry.execute('listComments', { pageId: PAGE.id, cursor }, CONTEXT),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      registry.execute(
        'listPageAttachments',
        { pageId: 'another-page', cursor },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oversized and malformed pagination cursors before querying children', async () => {
    const { registry } = buildRegistry();

    await expect(
      registry.execute(
        'listPageAttachments',
        { pageId: PAGE.id, cursor: 'x'.repeat(2049) },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      registry.execute(
        'listPageAttachments',
        { pageId: PAGE.id, cursor: 'not+base64' },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the highest explicit space role and keeps workspace bypass separate', async () => {
    const { registry } = buildRegistry({
      spaceRoles: [{ role: 'reader' }, { role: 'writer' }],
      rows: {
        spaces: [
          {
            id: CONTEXT.spaceId,
            name: 'Space',
            slug: 'space',
            visibility: 'private',
            archivedAt: null,
          },
        ],
      },
    });

    const result = await registry.execute('getSpaceContext', {}, CONTEXT);

    expect((result.content as any).actor).toMatchObject({
      workspaceRole: 'member',
      spaceRole: 'writer',
    });
  });

  it('returns no explicit space role for a workspace admin without membership', async () => {
    const { registry } = buildRegistry({
      rows: {
        spaces: [
          {
            id: CONTEXT.spaceId,
            name: 'Space',
            slug: 'space',
            visibility: 'private',
            archivedAt: null,
          },
        ],
      },
    });

    const result = await registry.execute(
      'getSpaceContext',
      {},
      {
        ...CONTEXT,
        user: { ...CONTEXT.user, role: 'admin' },
      },
    );

    expect((result.content as any).actor).toMatchObject({
      workspaceRole: 'admin',
      spaceRole: null,
    });
  });
});
