jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

const mockJsonToNode = jest.fn((content: any) => {
  const descendants = jest.fn((callback: (node: any) => void) => {
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type && node.type !== 'doc') {
        callback({
          type: { name: node.type },
          attrs: node.attrs ?? {},
          marks: node.marks ?? [],
        });
      }
      for (const child of node.content ?? []) visit(child);
    };
    visit(content);
  });

  return {
    descendants,
    toJSON: jest.fn(() => content),
  };
});
const mockGetAttachmentIds = jest.fn((_content: unknown): string[] => []);
const mockIsAttachmentNode = jest.fn((_type: string) => false);

jest.mock('../../../collaboration/collaboration.util', () => ({
  htmlToJson: jest.fn(),
  jsonToNode: (content: unknown) => mockJsonToNode(content),
  jsonToText: jest.fn(() => 'duplicated text'),
}));

jest.mock('../../../common/helpers/prosemirror/utils', () => ({
  createYdocFromJson: jest.fn(() => Buffer.from('ydoc')),
  getAttachmentIds: (content: unknown) => mockGetAttachmentIds(content),
  getProsemirrorContent: jest.fn((content: unknown) => content),
  isAttachmentNode: (type: string) => mockIsAttachmentNode(type),
  removeMarkTypeFromDoc: jest.fn((doc: unknown) => doc),
}));

import { executeTx } from '@docmost/db/utils';
import { PageService } from './page.service';

jest.mock('@docmost/db/utils', () => ({
  executeTx: jest.fn(),
}));

type TableName =
  | 'pages'
  | 'databases'
  | 'databaseProperties'
  | 'databaseRows'
  | 'databaseCells'
  | 'databaseViews';

function linkedInstanceDb(result?: unknown) {
  const query: any = {};
  for (const method of ['select', 'where', 'limit']) {
    query[method] = jest.fn(() => query);
  }
  query.executeTakeFirst = jest.fn().mockResolvedValue(result);
  return { selectFrom: jest.fn(() => query) };
}

function createService(params?: {
  pageRepo?: Record<string, jest.Mock>;
  attachmentRepo?: Record<string, jest.Mock>;
  db?: unknown;
  databaseRowRepo?: Record<string, jest.Mock>;
  generalQueue?: { add: jest.Mock };
  eventEmitter?: { emit: jest.Mock };
  queueOutboxService?: {
    enqueueDuplicatePageAttachments: jest.Mock;
    kick: jest.Mock;
  };
  pageAccessService?: {
    getEffectiveAccessForPages: jest.Mock;
  };
}) {
  const pageAccessService = params?.pageAccessService ?? {
    getEffectiveAccessForPages: jest.fn(async (pages: Array<{ id: string }>) =>
      new Map(
        pages.map((page) => [
          page.id,
          { capabilities: { canRead: true } },
        ]),
      ),
    ),
  };
  const service = new PageService(
    (params?.pageRepo ?? {}) as any,
    (params?.attachmentRepo ?? {}) as any,
    (params?.db ?? linkedInstanceDb()) as any,
    {} as any,
    {} as any,
    (params?.generalQueue ?? { add: jest.fn() }) as any,
    {} as any,
    (params?.eventEmitter ?? { emit: jest.fn() }) as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    (params?.databaseRowRepo ?? {}) as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    pageAccessService as any,
    {} as any,
    undefined,
    params?.queueOutboxService as any,
  );
  jest.spyOn(service as any, 'hasTemplateInPageTree').mockResolvedValue(false);
  return service;
}

function createMemoryTransaction(
  seed: Partial<Record<TableName, Array<Record<string, any>>>>,
) {
  const inserted: Partial<Record<TableName, Array<Record<string, any>>>> = {};

  const trx = {
    selectFrom: jest.fn((table: TableName) => {
      const conditions: Array<{
        column: string;
        operator: string;
        value: unknown;
      }> = [];
      const builder = {
        selectAll: jest.fn(() => builder),
        where: jest.fn((column: string, operator: string, value: unknown) => {
          conditions.push({ column, operator, value });
          return builder;
        }),
        orderBy: jest.fn(() => builder),
        execute: jest.fn(async () =>
          (seed[table] ?? []).filter((row) =>
            conditions.every(({ column, operator, value }) => {
              if (operator === 'in') {
                return (value as unknown[]).includes(row[column]);
              }
              if (operator === '=') {
                return row[column] === value;
              }
              if (operator === 'is' && value === null) {
                return row[column] === null;
              }
              return true;
            }),
          ),
        ),
      };
      return builder;
    }),
    insertInto: jest.fn((table: TableName) => ({
      values: jest.fn(
        (values: Record<string, any> | Record<string, any>[]) => ({
          execute: jest.fn(async () => {
            inserted[table] ??= [];
            inserted[table]!.push(
              ...(Array.isArray(values) ? values : [values]),
            );
          }),
        }),
      ),
    })),
  };

  return { trx, inserted };
}

describe('PageService duplicatePage properties', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAttachmentIds.mockReturnValue([]);
    mockIsAttachmentNode.mockReturnValue(false);
  });

  it('rejects ordinary duplication of a linked synchronized page', async () => {
    const rootPage = {
      id: 'page-root',
      slugId: 'root',
      title: 'Root',
      position: 'a0',
      parentPageId: null,
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      templateKind: null,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    };
    const pageRepo = {
      getPageAndDescendants: jest.fn().mockResolvedValue([rootPage]),
    };
    const service = createService({
      pageRepo,
      db: linkedInstanceDb({ id: 'instance' }),
    });

    await expect(
      service.duplicatePage(rootPage as any, undefined, {
        id: 'user-1',
        workspaceId: 'workspace-1',
      } as any),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_template_linked_page_duplicate_forbidden',
      }),
    });
    expect(executeTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'root template',
      pages: [
        {
          id: 'page-root',
          slugId: 'root',
          title: 'Root template',
          position: 'a0',
          parentPageId: null,
          spaceId: 'space-1',
          workspaceId: 'workspace-1',
          templateKind: 'regular',
          content: { type: 'doc', content: [] },
        },
      ],
    },
    {
      label: 'template descendant',
      pages: [
        {
          id: 'page-root',
          slugId: 'root',
          title: 'Ordinary root',
          position: 'a0',
          parentPageId: null,
          spaceId: 'space-1',
          workspaceId: 'workspace-1',
          templateKind: null,
          content: { type: 'doc', content: [] },
        },
        {
          id: 'page-template-child',
          slugId: 'template-child',
          title: 'Template child',
          position: 'a1',
          parentPageId: 'page-root',
          spaceId: 'space-1',
          workspaceId: 'workspace-1',
          templateKind: 'synced',
          content: { type: 'doc', content: [] },
        },
      ],
    },
  ])('rejects ordinary duplication of a $label', async ({ pages }) => {
    const pageRepo = {
      getPageAndDescendants: jest.fn().mockResolvedValue(pages),
    };
    const service = createService({ pageRepo });
    (service as any).hasTemplateInPageTree.mockResolvedValue(true);

    await expect(
      service.duplicatePage(pages[0] as any, undefined, {
        id: 'user-1',
        workspaceId: 'workspace-1',
      } as any),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_template_source_duplicate_forbidden',
      }),
    });
    expect(executeTx).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'same space', targetSpaceId: undefined },
    { label: 'another space', targetSpaceId: 'space-2' },
  ])(
    'rejects a $label duplicate when any source descendant is unreadable',
    async ({ targetSpaceId }) => {
      const pages = [
        {
          id: 'page-root',
          slugId: 'root',
          title: 'Root',
          position: 'a0',
          parentPageId: null,
          spaceId: 'space-1',
          workspaceId: 'workspace-1',
          templateKind: null,
          content: { type: 'doc', content: [] },
        },
        {
          id: 'page-denied-child',
          slugId: 'denied-child',
          title: 'Denied child',
          position: 'a1',
          parentPageId: 'page-root',
          spaceId: 'space-1',
          workspaceId: 'workspace-1',
          templateKind: null,
          content: { type: 'doc', content: [] },
        },
      ];
      const pageRepo = {
        getPageAndDescendants: jest.fn().mockResolvedValue(pages),
      };
      const pageAccessService = {
        getEffectiveAccessForPages: jest.fn().mockResolvedValue(
          new Map([
            ['page-root', { capabilities: { canRead: true } }],
            ['page-denied-child', { capabilities: { canRead: false } }],
          ]),
        ),
      };
      const queueOutboxService = {
        enqueueDuplicatePageAttachments: jest.fn(),
        kick: jest.fn(),
      };
      const beforeCommit = jest.fn();
      const service = createService({
        pageRepo,
        pageAccessService,
        queueOutboxService,
      });
      jest.spyOn(service, 'nextPagePosition').mockResolvedValue('z0');

      await expect(
        service.duplicatePage(
          pages[0] as any,
          targetSpaceId,
          { id: 'user-1', workspaceId: 'workspace-1' } as any,
          { beforeCommit },
        ),
      ).rejects.toMatchObject({ status: 403 });

      expect(pageAccessService.getEffectiveAccessForPages).toHaveBeenCalledWith(
        pages,
        expect.objectContaining({ id: 'user-1' }),
      );
      expect((service as any).hasTemplateInPageTree).not.toHaveBeenCalled();
      expect(executeTx).not.toHaveBeenCalled();
      expect(
        queueOutboxService.enqueueDuplicatePageAttachments,
      ).not.toHaveBeenCalled();
      expect(queueOutboxService.kick).not.toHaveBeenCalled();
      expect(beforeCommit).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: 'same space duplicate', targetSpaceId: undefined },
    { label: 'copy to another space', targetSpaceId: 'space-2' },
  ])(
    'preserves settings for every page during $label',
    async ({ targetSpaceId }) => {
      const rootSettings = {
        status: 'IN_PROGRESS',
        assigneeId: 'user-2',
        stakeholderIds: ['user-3'],
        aiRole: 'COAUTHOR',
      };
      const childSettings = {
        status: 'DONE',
        assigneeId: 'user-4',
        stakeholderIds: ['user-5', 'user-6'],
        aiRole: 'AUTHOR',
      };
      const pages = [
        {
          id: 'page-root',
          slugId: 'root-slug',
          title: 'Root',
          icon: null,
          content: { type: 'doc', content: [] },
          position: 'a0',
          parentPageId: null,
          spaceId: 'space-1',
          workspaceId: 'workspace-1',
          settings: rootSettings,
        },
        {
          id: 'page-child',
          slugId: 'child-slug',
          title: 'Child',
          icon: null,
          content: {
            type: 'doc',
            content: [
              {
                type: 'transclusionReference',
                attrs: {
                  sourcePageId: 'page-root',
                  transclusionId: 'block-1',
                },
              },
            ],
          },
          position: 'a1',
          parentPageId: 'page-root',
          spaceId: 'space-1',
          workspaceId: 'workspace-1',
          settings: childSettings,
        },
      ];
      const insertedPages: Array<Record<string, any>> = [];
      const pageRepo = {
        getPageAndDescendants: jest.fn(async () => pages),
        findById: jest.fn(async (pageId: string) =>
          insertedPages.find((page) => page.id === pageId),
        ),
      };
      const fakeTrx = {
        insertInto: jest.fn(() => ({
          values: jest.fn((values: Array<Record<string, any>>) => ({
            execute: jest.fn(async () => insertedPages.push(...values)),
          })),
        })),
      };
      const service = createService({ pageRepo });
      jest
        .spyOn(service as any, 'duplicateLinkedDatabases')
        .mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'duplicateRowsInExistingDatabases')
        .mockResolvedValue(undefined);
      jest.spyOn(service, 'nextPagePosition').mockResolvedValue('z0');
      (executeTx as jest.Mock).mockImplementation(async (_db, handler) =>
        handler(fakeTrx),
      );

      await service.duplicatePage(pages[0] as any, targetSpaceId, {
        id: 'user-1',
        workspaceId: 'workspace-1',
      } as any);

      expect(insertedPages).toHaveLength(2);
      expect(insertedPages[0].settings).toEqual(rootSettings);
      expect(insertedPages[1].settings).toEqual(childSettings);
      expect(insertedPages[0].creatorId).toBe('user-1');
      expect(insertedPages[1].creatorId).toBe('user-1');
      expect(insertedPages[0]).not.toHaveProperty('createdAt');
      expect(insertedPages[1].parentPageId).toBe(insertedPages[0].id);
      expect(insertedPages[1].content.content[0].attrs.sourcePageId).toBe(
        insertedPages[0].id,
      );
      expect(
        insertedPages.every(
          (page) => page.spaceId === (targetSpaceId ?? 'space-1'),
        ),
      ).toBe(true);
    },
  );

  it('copies active database fields and remaps copied page references', async () => {
    const { trx, inserted } = createMemoryTransaction({
      databases: [
        {
          id: 'database-old',
          pageId: 'page-root',
          spaceId: 'space-1',
          workspaceId: 'workspace-1',
          name: 'Database',
          description: 'Description',
          descriptionContent: { type: 'doc' },
          icon: 'database-icon',
          deletedAt: null,
        },
      ],
      databaseProperties: [
        {
          id: 'property-select',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          name: 'Priority',
          type: 'select',
          settings: { options: [{ label: 'High', value: 'high' }] },
          position: 0,
          deletedAt: null,
        },
        {
          id: 'property-internal-ref',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          name: 'Parent',
          type: 'page_reference',
          settings: null,
          position: 1,
          deletedAt: null,
        },
        {
          id: 'property-external-ref',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          name: 'External',
          type: 'page_reference',
          settings: null,
          position: 2,
          deletedAt: null,
        },
        {
          id: 'property-deleted',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          name: 'Deleted',
          type: 'code',
          settings: null,
          position: 3,
          deletedAt: new Date(),
        },
      ],
      databaseRows: [
        {
          id: 'row-link-active',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          pageId: 'page-row-active',
          archivedAt: null,
        },
        {
          id: 'row-link-archived',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          pageId: 'page-row-archived',
          archivedAt: new Date(),
        },
      ],
      databaseCells: [
        {
          id: 'cell-select',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          pageId: 'page-row-active',
          propertyId: 'property-select',
          value: 'high',
          attachmentId: null,
          deletedAt: null,
        },
        {
          id: 'cell-internal-ref',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          pageId: 'page-row-active',
          propertyId: 'property-internal-ref',
          value: 'page-root',
          attachmentId: null,
          deletedAt: null,
        },
        {
          id: 'cell-external-ref',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          pageId: 'page-row-active',
          propertyId: 'property-external-ref',
          value: 'external-page',
          attachmentId: null,
          deletedAt: null,
        },
        {
          id: 'cell-deleted',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          pageId: 'page-row-active',
          propertyId: 'property-select',
          value: 'ignored',
          attachmentId: null,
          deletedAt: new Date(),
        },
        {
          id: 'cell-archived-row',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          pageId: 'page-row-archived',
          propertyId: 'property-select',
          value: 'ignored',
          attachmentId: null,
          deletedAt: null,
        },
      ],
      databaseViews: [
        {
          id: 'view-active',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          name: 'Default',
          type: 'table',
          config: {
            sortPropertyId: 'property-select',
            visible: { 'property-internal-ref': true },
          },
          deletedAt: null,
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'view-deleted',
          databaseId: 'database-old',
          workspaceId: 'workspace-1',
          name: 'Deleted',
          type: 'table',
          config: null,
          deletedAt: new Date(),
          createdAt: new Date('2026-01-02'),
        },
      ],
    });
    const service = createService();
    const pageMap = new Map([
      [
        'page-root',
        {
          newPageId: 'page-root-copy',
          newSlugId: 'root-copy',
          oldSlugId: 'root',
        },
      ],
      [
        'page-row-active',
        { newPageId: 'page-row-copy', newSlugId: 'row-copy', oldSlugId: 'row' },
      ],
      [
        'page-row-archived',
        {
          newPageId: 'page-row-archived-copy',
          newSlugId: 'archived-copy',
          oldSlugId: 'archived',
        },
      ],
    ]);

    await (service as any).duplicateLinkedDatabases({
      pageMap,
      copiedPageByOriginalId: new Map([
        ['page-root', { id: 'page-root-copy', title: 'Copy of Database' }],
      ]),
      spaceId: 'space-2',
      authUser: { id: 'user-1' },
      trx,
    });

    const copiedDatabase = inserted.databases![0];
    const copiedProperties = inserted.databaseProperties!;
    const propertyByName = new Map(
      copiedProperties.map((property) => [property.name, property]),
    );
    const copiedCells = inserted.databaseCells!;
    const cellByPropertyId = new Map(
      copiedCells.map((cell) => [cell.propertyId, cell]),
    );

    expect(copiedDatabase).toEqual(
      expect.objectContaining({
        spaceId: 'space-2',
        pageId: 'page-root-copy',
        name: 'Copy of Database',
        description: 'Description',
      }),
    );
    expect(copiedDatabase.id).not.toBe('database-old');
    expect(copiedProperties).toHaveLength(3);
    expect(propertyByName.get('Priority')).toEqual(
      expect.objectContaining({
        databaseId: copiedDatabase.id,
        settings: { options: [{ label: 'High', value: 'high' }] },
      }),
    );
    expect(inserted.databaseRows).toEqual([
      expect.objectContaining({
        databaseId: copiedDatabase.id,
        pageId: 'page-row-copy',
      }),
    ]);
    expect(copiedCells).toHaveLength(3);
    expect(
      cellByPropertyId.get(propertyByName.get('Priority')!.id)?.value,
    ).toBe('high');
    expect(cellByPropertyId.get(propertyByName.get('Parent')!.id)?.value).toBe(
      'page-root-copy',
    );
    expect(
      cellByPropertyId.get(propertyByName.get('External')!.id)?.value,
    ).toBe('external-page');
    expect(inserted.databaseViews).toHaveLength(1);
    expect(inserted.databaseViews![0].config).toEqual({
      sortPropertyId: propertyByName.get('Priority')!.id,
      visible: { [propertyByName.get('Parent')!.id]: true },
    });
  });

  it('duplicates a database row in place with active cells and remapped references', async () => {
    const { trx, inserted } = createMemoryTransaction({
      databases: [
        {
          id: 'database-1',
          pageId: 'database-page',
          deletedAt: null,
        },
      ],
      databaseRows: [
        {
          id: 'row-1',
          databaseId: 'database-1',
          workspaceId: 'workspace-1',
          pageId: 'row-page',
          archivedAt: null,
        },
        {
          id: 'row-archived',
          databaseId: 'database-1',
          workspaceId: 'workspace-1',
          pageId: 'archived-row-page',
          archivedAt: new Date(),
        },
      ],
      databaseProperties: [
        {
          id: 'property-reference',
          databaseId: 'database-1',
          type: 'page_reference',
          deletedAt: null,
        },
        {
          id: 'property-deleted',
          databaseId: 'database-1',
          type: 'multiline_text',
          deletedAt: new Date(),
        },
      ],
      databaseCells: [
        {
          id: 'cell-reference',
          databaseId: 'database-1',
          workspaceId: 'workspace-1',
          pageId: 'row-page',
          propertyId: 'property-reference',
          value: 'child-page',
          attachmentId: null,
          deletedAt: null,
        },
        {
          id: 'cell-deleted-property',
          databaseId: 'database-1',
          workspaceId: 'workspace-1',
          pageId: 'row-page',
          propertyId: 'property-deleted',
          value: 'ignored',
          attachmentId: null,
          deletedAt: null,
        },
      ],
    });
    const service = createService();
    const pageMap = new Map([
      [
        'row-page',
        {
          newPageId: 'row-page-copy',
          newSlugId: 'row-copy',
          oldSlugId: 'row',
        },
      ],
      [
        'child-page',
        {
          newPageId: 'child-page-copy',
          newSlugId: 'child-copy',
          oldSlugId: 'child',
        },
      ],
    ]);

    await (service as any).duplicateRowsInExistingDatabases({
      pageMap,
      authUser: { id: 'user-1' },
      trx,
    });

    expect(inserted.databaseRows).toEqual([
      expect.objectContaining({
        databaseId: 'database-1',
        pageId: 'row-page-copy',
        createdById: 'user-1',
      }),
    ]);
    expect(inserted.databaseCells).toEqual([
      expect.objectContaining({
        databaseId: 'database-1',
        pageId: 'row-page-copy',
        propertyId: 'property-reference',
        value: 'child-page-copy',
      }),
    ]);
  });

  it('persists attachment-copy work in the page transaction before signaling the queue', async () => {
    const rootPage = {
      id: 'page-root',
      slugId: 'root-slug',
      title: 'Root',
      icon: null,
      content: {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              attachmentId: 'attachment-old',
              src: '/api/attachments/files/attachment-old/image.png',
            },
          },
        ],
      },
      position: 'a0',
      parentPageId: null,
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      settings: {},
    };
    const fakeTrx = {
      insertInto: jest.fn(() => ({
        values: jest.fn(() => ({ execute: jest.fn() })),
      })),
    };
    let transactionActive = false;
    let transactionCommitted = false;
    const queueOutboxService = {
      enqueueDuplicatePageAttachments: jest.fn(async (_payload, trx) => {
        expect(transactionActive).toBe(true);
        expect(trx).toBe(fakeTrx);
      }),
      kick: jest.fn(() => {
        expect(transactionCommitted).toBe(true);
      }),
    };
    const beforeCommit = jest.fn(async (trx, duplicatedRootPageId) => {
      expect(transactionActive).toBe(true);
      expect(trx).toBe(fakeTrx);
      expect(duplicatedRootPageId).toBe('page-copy-idempotent');
    });
    const pageRepo = {
      getPageAndDescendants: jest.fn(async () => [rootPage]),
      findById: jest.fn(async (pageId: string) => ({ id: pageId })),
    };
    const attachmentRepo = {
      findActiveByIds: jest.fn().mockResolvedValue([
        {
          id: 'attachment-old',
          pageId: 'page-root',
          workspaceId: 'workspace-1',
          deletedAt: null,
        },
      ]),
    };
    const service = createService({
      pageRepo,
      attachmentRepo,
      queueOutboxService,
    });
    jest
      .spyOn(service as any, 'duplicateLinkedDatabases')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'duplicateRowsInExistingDatabases')
      .mockResolvedValue(undefined);
    (executeTx as jest.Mock).mockImplementation(async (_db, handler) => {
      transactionActive = true;
      const result = await handler(fakeTrx);
      transactionActive = false;
      transactionCommitted = true;
      return result;
    });
    mockGetAttachmentIds.mockReturnValue(['attachment-old']);
    mockIsAttachmentNode.mockImplementation((type) => type === 'image');

    await service.duplicatePage(
      rootPage as any,
      undefined,
      {
        id: 'user-1',
        workspaceId: 'workspace-1',
      } as any,
      {
        rootPageId: 'page-copy-idempotent',
        beforeCommit,
      },
    );

    expect(
      queueOutboxService.enqueueDuplicatePageAttachments,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        rootPageId: 'page-root',
        newPageId: 'page-copy-idempotent',
        spaceId: 'space-1',
        attachmentMappings: [
          expect.objectContaining({
            oldPageId: 'page-root',
            oldAttachmentId: 'attachment-old',
          }),
        ],
      }),
      fakeTrx,
    );
    expect(beforeCommit).toHaveBeenCalledWith(
      fakeTrx,
      'page-copy-idempotent',
    );
    expect(queueOutboxService.kick).toHaveBeenCalledTimes(1);
  });

  it('rejects an attachment referenced from multiple subtree pages before inserting pages', async () => {
    const sharedAttachmentId = 'attachment-shared';
    const pages = [
      {
        id: 'page-root',
        slugId: 'root',
        title: 'Root',
        icon: null,
        content: {
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: {
                attachmentId: sharedAttachmentId,
                src: `/api/attachments/files/${sharedAttachmentId}/image.png`,
              },
            },
          ],
        },
        position: 'a0',
        parentPageId: null,
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
        settings: {},
      },
      {
        id: 'page-child',
        slugId: 'child',
        title: 'Child',
        icon: null,
        content: {
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: {
                attachmentId: sharedAttachmentId,
                src: `/api/attachments/files/${sharedAttachmentId}/image.png`,
              },
            },
          ],
        },
        position: 'a1',
        parentPageId: 'page-root',
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
        settings: {},
      },
    ];
    const pageRepo = {
      getPageAndDescendants: jest.fn().mockResolvedValue(pages),
    };
    const attachmentRepo = {
      findActiveByIds: jest.fn().mockResolvedValue([
        {
          id: sharedAttachmentId,
          pageId: 'page-root',
          workspaceId: 'workspace-1',
          deletedAt: null,
        },
      ]),
    };
    const service = createService({
      pageRepo,
      attachmentRepo,
    });
    mockGetAttachmentIds.mockReturnValue([sharedAttachmentId]);
    mockIsAttachmentNode.mockImplementation((type) => type === 'image');

    await expect(
      service.duplicatePage(
        pages[0] as any,
        undefined,
        { id: 'user-1', workspaceId: 'workspace-1' } as any,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_attachment_source_invalid',
      }),
    });

    expect(attachmentRepo.findActiveByIds).toHaveBeenCalledWith(
      [sharedAttachmentId],
      'workspace-1',
    );
    expect(executeTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'is missing',
      sourceAttachments: [],
    },
    {
      label: 'is owned outside the copied subtree',
      sourceAttachments: [
        {
          id: 'attachment-external',
          pageId: 'page-outside-tree',
          workspaceId: 'workspace-1',
          deletedAt: null,
        },
      ],
    },
  ])(
    'rejects an attachment that $label before inserting pages',
    async ({ sourceAttachments }) => {
      const rootPage = {
        id: 'page-root',
        slugId: 'root',
        title: 'Root',
        content: { type: 'doc', content: [] },
        position: 'a0',
        parentPageId: null,
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
        settings: {},
      };
      const pageRepo = {
        getPageAndDescendants: jest.fn().mockResolvedValue([rootPage]),
      };
      const attachmentRepo = {
        findActiveByIds: jest.fn().mockResolvedValue(sourceAttachments),
      };
      const service = createService({ pageRepo, attachmentRepo });
      mockGetAttachmentIds.mockReturnValue(['attachment-external']);

      await expect(
        service.duplicatePage(
          rootPage as any,
          undefined,
          { id: 'user-1', workspaceId: 'workspace-1' } as any,
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'page_attachment_source_invalid',
        }),
      });

      expect(executeTx).not.toHaveBeenCalled();
    },
  );
});
