jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PageController } from './page.controller';

describe('PageController guardrails and mixed-id contract', () => {
  const pageService = {
    getSidebarPages: jest.fn(),
    movePage: jest.fn(),
    update: jest.fn(),
    duplicatePage: jest.fn(),
    resolvePageDatabaseId: jest.fn(),
    forceDelete: jest.fn(),
    removePage: jest.fn(),
  };
  const pageRepo = {
    findById: jest.fn(),
    findReferencesByIds: jest.fn(),
    restorePage: jest.fn(),
  };
  const pageHistoryService = {
    findMetadataById: jest.fn(),
    deleteById: jest.fn(),
  };
  const spaceAbility = {
    createForUser: jest.fn(async () => ({ cannot: () => false })),
  };
  const databaseRepo = {
    findByPageId: jest.fn(),
  };
  const labelService = {};
  const backlinkService = {};
  const pageAccessService = {
    assertCanReadPage: jest.fn(async () => ({
      role: 'writer',
      sources: ['space'],
      capabilities: {
        canRead: true,
        canWrite: true,
        canCreateChild: true,
        canMoveDeleteShare: true,
        canManageAccess: false,
      },
      isSystemAccess: false,
    })),
    assertCanWritePage: jest.fn(async () => ({
      role: 'writer',
      sources: ['space'],
      capabilities: {
        canRead: true,
        canWrite: true,
        canCreateChild: true,
        canMoveDeleteShare: true,
        canManageAccess: false,
      },
      isSystemAccess: false,
    })),
    assertCanMoveDeleteShare: jest.fn(async () => ({
      role: 'writer',
      sources: ['space'],
      capabilities: {
        canRead: true,
        canWrite: true,
        canCreateChild: true,
        canMoveDeleteShare: true,
        canManageAccess: false,
      },
      isSystemAccess: false,
    })),
    assertCanCreateChild: jest.fn(async () => ({
      role: 'writer',
      sources: ['space'],
      capabilities: {
        canRead: true,
        canWrite: true,
        canCreateChild: true,
        canMoveDeleteShare: true,
        canManageAccess: false,
      },
      isSystemAccess: false,
    })),
    assertCanManageAccess: jest.fn(),
    getEffectiveAccess: jest.fn(async () => ({
      role: 'writer',
      sources: ['space'],
      capabilities: {
        canRead: true,
        canWrite: true,
        canCreateChild: true,
        canMoveDeleteShare: true,
        canManageAccess: false,
      },
      isSystemAccess: false,
    })),
    getEffectiveAccessForPages: jest.fn(),
    getSidebarAccessSnapshot: jest.fn(async () => ({
      visiblePageIds: new Set(['uuid-page', 'p1', 'parent']),
      readablePageIds: new Set(['uuid-page', 'p1', 'parent']),
      writablePageIds: new Set(['uuid-page', 'p1', 'parent']),
      createChildPageIds: new Set(['uuid-page', 'p1', 'parent']),
      moveDeleteSharePageIds: new Set(['uuid-page', 'p1', 'parent']),
      manageAccessPageIds: new Set(),
      visibleChildrenCountByParentId: new Map<string, number>(),
    })),
    hasAnyReadablePageInSpace: jest.fn(async () => true),
    isWorkspaceBypassUser: jest.fn(() => false),
  };
  const linkPreviewService = {
    getPreview: jest.fn(),
  };
  const pageAccessMutationService = {};
  const pageTemplateSyncService = {
    catchUpRestoredInstances: jest.fn(),
  };
  const pageTemplateOperations = {
    beginOperation: jest.fn(),
    completeOperationInTransaction: jest.fn(),
    failOperation: jest.fn(),
    errorCode: jest.fn(() => 'page_duplicate_failed'),
  };

  const controller = new PageController(
    pageService as any,
    pageRepo as any,
    pageHistoryService as any,
    spaceAbility as any,
    databaseRepo as any,
    pageAccessService as any,
    pageAccessMutationService as any,
    labelService as any,
    backlinkService as any,
    linkPreviewService as any,
    pageTemplateSyncService as any,
    pageTemplateOperations as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    pageService.getSidebarPages.mockResolvedValue({ items: [] });
    pageService.update.mockResolvedValue({ id: 'uuid-page', settings: null });
    pageRepo.restorePage.mockResolvedValue(['uuid-page']);
    pageTemplateSyncService.catchUpRestoredInstances.mockResolvedValue(
      undefined,
    );
    pageTemplateOperations.completeOperationInTransaction.mockResolvedValue(
      undefined,
    );
    pageTemplateOperations.failOperation.mockResolvedValue(undefined);
    pageHistoryService.findMetadataById.mockResolvedValue({
      id: 'history-1',
      workspaceId: 'workspace-1',
    });
    pageAccessService.assertCanManageAccess.mockImplementation(
      (user: { role?: string; workspaceId?: string }, workspaceId: string) => {
        if (
          (user.role !== 'owner' && user.role !== 'admin') ||
          user.workspaceId !== workspaceId
        ) {
          throw new ForbiddenException();
        }
      },
    );
    pageRepo.findById.mockResolvedValue({
      id: 'uuid-page',
      slugId: 'docs-home',
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
      content: null,
      settings: null,
      contributorIds: [],
    });
    pageRepo.findReferencesByIds.mockResolvedValue([]);
    pageAccessService.getEffectiveAccessForPages.mockResolvedValue(new Map());
  });

  it('returns each readable page reference once and omits inaccessible pages', async () => {
    const readablePage = {
      id: '11111111-1111-4111-8111-111111111111',
      slugId: 'readable',
      title: 'Readable',
      icon: 'page',
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
    };
    const deniedPage = {
      id: '22222222-2222-4222-8222-222222222222',
      slugId: 'denied',
      title: 'Denied',
      icon: null,
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
    };
    pageRepo.findReferencesByIds.mockResolvedValue([deniedPage, readablePage]);
    pageAccessService.getEffectiveAccessForPages.mockResolvedValue(
      new Map([
        [readablePage.id, { capabilities: { canRead: true } }],
        [deniedPage.id, { capabilities: { canRead: false } }],
      ]),
    );

    const result = await controller.getPageReferences(
      {
        ids: [readablePage.id, deniedPage.id, readablePage.id],
      },
      { id: 'u1', workspaceId: 'workspace-1' } as any,
    );

    expect(pageRepo.findReferencesByIds).toHaveBeenCalledWith(
      [readablePage.id, deniedPage.id],
      'workspace-1',
    );
    expect(result).toEqual([
      {
        id: readablePage.id,
        slugId: readablePage.slugId,
        title: readablePage.title,
        icon: readablePage.icon,
      },
    ]);
  });

  it('omits missing and deleted page references returned as absent by the repository', async () => {
    const readableId = '11111111-1111-4111-8111-111111111111';
    const missingId = '22222222-2222-4222-8222-222222222222';
    const deletedId = '33333333-3333-4333-8333-333333333333';
    const readablePage = {
      id: readableId,
      slugId: 'readable',
      title: 'Readable',
      icon: null,
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
    };
    pageRepo.findReferencesByIds.mockResolvedValue([readablePage]);
    pageAccessService.getEffectiveAccessForPages.mockResolvedValue(
      new Map([[readableId, { capabilities: { canRead: true } }]]),
    );

    const result = await controller.getPageReferences(
      { ids: [readableId, missingId, deletedId] },
      { id: 'u1', workspaceId: 'workspace-1' } as any,
    );

    expect(result).toEqual([
      {
        id: readableId,
        slugId: 'readable',
        title: 'Readable',
        icon: null,
      },
    ]);
  });

  it('sidebar-pages rejects mismatched pageId/spaceId', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'p1',
      spaceId: 'space-a',
      deletedAt: null,
    });

    await expect(
      controller.getSidebarPages(
        { pageId: 'p1', spaceId: 'space-b' } as any,
        { id: 'u1' } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('move rejects self-parenting', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'p1',
      spaceId: 'space-a',
      deletedAt: null,
    });

    await expect(
      controller.movePage(
        { pageId: 'p1', parentPageId: 'p1', position: 'aaaaa' } as any,
        { id: 'u1' } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('move rejects deleted parent page', async () => {
    pageRepo.findById
      .mockResolvedValueOnce({ id: 'p1', spaceId: 'space-a', deletedAt: null })
      .mockResolvedValueOnce({
        id: 'parent',
        spaceId: 'space-a',
        deletedAt: new Date(),
      });

    await expect(
      controller.movePage(
        { pageId: 'p1', parentPageId: 'parent', position: 'aaaaa' } as any,
        { id: 'u1' } as any,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows update endpoint with slug identifier via findById mixed-id lookup', async () => {
    await controller.update(
      { pageId: 'docs-home' } as any,
      { id: 'u1' } as any,
    );

    expect(pageRepo.findById).toHaveBeenCalledWith('docs-home');
    expect(pageService.update).toHaveBeenCalled();
  });

  it('normalizes settings in pages/info response to undefined when source is null', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'uuid-page',
      slugId: 'docs-home',
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
      content: { type: 'doc' },
      settings: null,
      contributorIds: [],
    });
    databaseRepo.findByPageId.mockResolvedValue(null);

    const result = await controller.getPage(
      { pageId: 'uuid-page' } as any,
      { id: 'u1' } as any,
    );

    expect(result.settings).toBeUndefined();
    expect(result.customFields).toEqual({
      status: null,
      assigneeId: null,
      stakeholderIds: [],
      aiRole: 'NONE',
    });
  });

  it('rejects deleted pages from pages/info', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'uuid-page',
      slugId: 'docs-home',
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
      deletedAt: new Date(),
    });

    await expect(
      controller.getPage({ pageId: 'docs-home' } as any, { id: 'u1' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageAccessService.assertCanReadPage).not.toHaveBeenCalled();
  });

  it('normalizes settings in pages/update response to undefined when source is null', async () => {
    pageService.update.mockResolvedValue({
      id: 'uuid-page',
      slugId: 'docs-home',
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
      content: null,
      settings: null,
      contributorIds: [],
    });

    const result = await controller.update(
      { pageId: 'docs-home' } as any,
      { id: 'u1' } as any,
    );

    expect(result.settings).toBeUndefined();
    expect(result.customFields).toEqual({
      status: null,
      assigneeId: null,
      stakeholderIds: [],
      aiRole: 'NONE',
    });
  });

  it.each([
    { label: 'duplicate', dto: { pageId: 'uuid-page' } },
    {
      label: 'copy to space',
      dto: { pageId: 'uuid-page', spaceId: 'space-b' },
    },
  ])('includes custom fields in $label response', async ({ dto }) => {
    pageService.duplicatePage.mockResolvedValue({
      id: 'duplicated-page',
      slugId: 'duplicated-page-slug',
      spaceId: dto.spaceId ?? 'space-a',
      workspaceId: 'workspace-1',
      settings: {
        status: 'IN_REVIEW',
        assigneeId: 'user-2',
        stakeholderIds: ['user-3', 'user-4'],
        aiRole: 'COAUTHOR_PLUS',
      },
    });
    pageService.resolvePageDatabaseId.mockResolvedValue('database-1');

    const result = await controller.duplicatePage(
      dto as any,
      { id: 'user-1', workspaceId: 'workspace-1' } as any,
    );

    expect(result.customFields).toEqual({
      status: 'IN_REVIEW',
      assigneeId: 'user-2',
      stakeholderIds: ['user-3', 'user-4'],
      aiRole: 'COAUTHOR_PLUS',
    });
    expect(result.databaseId).toBe('database-1');
  });

  it('completes an idempotent duplicate operation inside the page transaction', async () => {
    const operation = {
      id: 'operation-1',
      leaseToken: 'lease-1',
      resultPageId: 'duplicated-page',
      status: 'pending',
    };
    pageTemplateOperations.beginOperation.mockResolvedValue(operation);
    pageService.duplicatePage.mockImplementation(
      async (_page, _spaceId, _user, options) => {
        await options.beforeCommit({ transaction: true }, 'duplicated-page');
        return {
          id: 'duplicated-page',
          slugId: 'duplicated-page-slug',
          spaceId: 'space-a',
          workspaceId: 'workspace-1',
          settings: null,
        };
      },
    );
    pageService.resolvePageDatabaseId.mockResolvedValue(null);

    const result = await controller.duplicatePage(
      { pageId: 'uuid-page' } as any,
      { id: 'user-1', workspaceId: 'workspace-1' } as any,
      'duplicate-request-1',
    );

    expect(pageTemplateOperations.beginOperation).toHaveBeenCalledWith(
      'page_duplicate',
      'duplicate-request-1',
      expect.objectContaining({ id: 'user-1' }),
      { pageId: 'uuid-page', spaceId: null },
      expect.objectContaining({
        sourcePageId: 'uuid-page',
        resultPageId: expect.any(String),
      }),
    );
    expect(pageService.duplicatePage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'uuid-page' }),
      undefined,
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({ rootPageId: 'duplicated-page' }),
    );
    expect(
      pageTemplateOperations.completeOperationInTransaction,
    ).toHaveBeenCalledWith(
      { transaction: true },
      'operation-1',
      'lease-1',
      { resultPageId: 'duplicated-page' },
    );
    expect(result.id).toBe('duplicated-page');
  });

  it('replays a completed duplicate without creating a second page tree', async () => {
    pageTemplateOperations.beginOperation.mockResolvedValue({
      id: 'operation-1',
      leaseToken: null,
      resultPageId: 'duplicated-page',
      status: 'completed',
    });
    pageRepo.findById
      .mockResolvedValueOnce({
        id: 'uuid-page',
        slugId: 'source',
        spaceId: 'space-a',
        workspaceId: 'workspace-1',
      })
      .mockResolvedValueOnce({
        id: 'duplicated-page',
        slugId: 'duplicated-page-slug',
        spaceId: 'space-a',
        workspaceId: 'workspace-1',
        settings: null,
      });
    pageService.resolvePageDatabaseId.mockResolvedValue(null);

    const result = await controller.duplicatePage(
      { pageId: 'uuid-page' } as any,
      { id: 'user-1', workspaceId: 'workspace-1' } as any,
      'duplicate-request-1',
    );

    expect(pageService.duplicatePage).not.toHaveBeenCalled();
    expect(result.id).toBe('duplicated-page');
  });

  it('keeps legacy duplicate calls working and marks the response deprecated', async () => {
    const response = { header: jest.fn() };
    pageService.duplicatePage.mockResolvedValue({
      id: 'duplicated-page',
      slugId: 'duplicated-page-slug',
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
      settings: null,
    });
    pageService.resolvePageDatabaseId.mockResolvedValue(null);

    await controller.duplicatePage(
      { pageId: 'uuid-page' } as any,
      { id: 'user-1', workspaceId: 'workspace-1' } as any,
      undefined,
      response as any,
    );

    expect(pageTemplateOperations.beginOperation).not.toHaveBeenCalled();
    expect(response.header).toHaveBeenCalledWith('Deprecation', 'true');
    expect(response.header).toHaveBeenCalledWith(
      'X-Docmost-Required-Header',
      'Idempotency-Key',
    );
  });

  it('rejects unsafe idempotency keys before reserving an operation', async () => {
    await expect(
      controller.duplicatePage(
        { pageId: 'uuid-page' } as any,
        { id: 'user-1', workspaceId: 'workspace-1' } as any,
        'unsafe:key',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'idempotency_key_invalid' }),
    });

    expect(pageTemplateOperations.beginOperation).not.toHaveBeenCalled();
  });

  it('rejects a same-space sibling duplicate when the parent denies child creation', async () => {
    const sourcePage = {
      id: 'uuid-page',
      slugId: 'source',
      parentPageId: 'parent-page',
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
    };
    const parentPage = {
      id: 'parent-page',
      slugId: 'parent',
      parentPageId: null,
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
      deletedAt: null,
    };
    pageRepo.findById
      .mockResolvedValueOnce(sourcePage)
      .mockResolvedValueOnce(parentPage);
    pageAccessService.assertCanCreateChild.mockRejectedValueOnce(
      new ForbiddenException(),
    );

    await expect(
      controller.duplicatePage(
        { pageId: 'uuid-page', spaceId: 'space-a' } as any,
        { id: 'user-1', workspaceId: 'workspace-1' } as any,
        'duplicate-request-parent-denied',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageAccessService.assertCanWritePage).toHaveBeenCalledWith(
      sourcePage,
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(pageAccessService.assertCanReadPage).not.toHaveBeenCalled();
    expect(pageAccessService.assertCanCreateChild).toHaveBeenCalledWith(
      parentPage,
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(pageTemplateOperations.beginOperation).not.toHaveBeenCalled();
    expect(
      pageTemplateOperations.completeOperationInTransaction,
    ).not.toHaveBeenCalled();
    expect(pageService.duplicatePage).not.toHaveBeenCalled();
  });

  it('rejects a root sibling duplicate when the space denies page creation', async () => {
    (spaceAbility.createForUser as jest.Mock).mockResolvedValueOnce({
      cannot: jest.fn(() => true),
    });

    await expect(
      controller.duplicatePage(
        { pageId: 'uuid-page' } as any,
        { id: 'user-1', workspaceId: 'workspace-1' } as any,
        'duplicate-request-root-denied',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageAccessService.assertCanWritePage).toHaveBeenCalled();
    expect(spaceAbility.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'space-a',
    );
    expect(pageTemplateOperations.beginOperation).not.toHaveBeenCalled();
    expect(
      pageTemplateOperations.completeOperationInTransaction,
    ).not.toHaveBeenCalled();
    expect(pageService.duplicatePage).not.toHaveBeenCalled();
  });

  it('requires page creation permission when copying to another space', async () => {
    const cannot = jest.fn((action: string) => action === 'create');
    (spaceAbility.createForUser as jest.Mock).mockResolvedValueOnce({ cannot });

    await expect(
      controller.duplicatePage(
        { pageId: 'uuid-page', spaceId: 'space-b' } as any,
        { id: 'user-1', workspaceId: 'workspace-1' } as any,
        'duplicate-request-target-denied',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageAccessService.assertCanReadPage).toHaveBeenCalled();
    expect(pageAccessService.assertCanWritePage).not.toHaveBeenCalled();
    expect(cannot).toHaveBeenCalledWith('create', 'page');
    expect(pageTemplateOperations.beginOperation).not.toHaveBeenCalled();
    expect(pageService.duplicatePage).not.toHaveBeenCalled();
  });

  it('uses resolved UUID for permanent delete even when slug is provided', async () => {
    await controller.delete(
      { pageId: 'docs-home', permanentlyDelete: true } as any,
      { id: 'u1' } as any,
      { id: 'workspace-1' } as any,
    );

    expect(pageService.forceDelete).toHaveBeenCalledWith(
      'uuid-page',
      'workspace-1',
    );
  });

  it('uses resolved UUID for soft delete even when slug is provided', async () => {
    await controller.delete(
      { pageId: 'docs-home', permanentlyDelete: false } as any,
      { id: 'u1' } as any,
      { id: 'workspace-1' } as any,
    );

    expect(pageService.removePage).toHaveBeenCalledWith(
      'uuid-page',
      'u1',
      'workspace-1',
    );
  });

  it('uses resolved UUID for restore even when slug is provided', async () => {
    await controller.restore(
      { pageId: 'docs-home' } as any,
      { id: 'u1' } as any,
      { id: 'workspace-1' } as any,
    );

    expect(pageRepo.restorePage).toHaveBeenCalledWith(
      'uuid-page',
      'workspace-1',
    );
    expect(pageRepo.findById).toHaveBeenLastCalledWith('uuid-page', {
      includeHasChildren: true,
    });
    expect(
      pageTemplateSyncService.catchUpRestoredInstances,
    ).toHaveBeenCalledWith(
      ['uuid-page'],
      expect.objectContaining({ id: 'u1' }),
    );
  });

  it('deletes a history entry after workspace admin authorization', async () => {
    await expect(
      controller.deletePageHistory(
        { historyId: 'history-1' } as any,
        { id: 'admin-1', workspaceId: 'workspace-1', role: 'admin' } as any,
      ),
    ).resolves.toBeUndefined();

    expect(pageAccessService.assertCanManageAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1', role: 'admin' }),
      'workspace-1',
    );
    expect(pageHistoryService.deleteById).toHaveBeenCalledWith('history-1');
  });

  it('returns not found without attempting authorization for missing history', async () => {
    pageHistoryService.findMetadataById.mockResolvedValueOnce(undefined);

    await expect(
      controller.deletePageHistory(
        { historyId: 'missing-history' } as any,
        { id: 'admin-1', workspaceId: 'workspace-1', role: 'admin' } as any,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageAccessService.assertCanManageAccess).not.toHaveBeenCalled();
    expect(pageHistoryService.deleteById).not.toHaveBeenCalled();
  });

  it('does not delete history for a workspace member', async () => {
    await expect(
      controller.deletePageHistory(
        { historyId: 'history-1' } as any,
        { id: 'member-1', workspaceId: 'workspace-1', role: 'member' } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageHistoryService.deleteById).not.toHaveBeenCalled();
  });

  it('does not delete history from another workspace', async () => {
    pageHistoryService.findMetadataById.mockResolvedValueOnce({
      id: 'history-2',
      workspaceId: 'workspace-2',
    });

    await expect(
      controller.deletePageHistory(
        { historyId: 'history-2' } as any,
        { id: 'admin-1', workspaceId: 'workspace-1', role: 'admin' } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageHistoryService.deleteById).not.toHaveBeenCalled();
  });
});
