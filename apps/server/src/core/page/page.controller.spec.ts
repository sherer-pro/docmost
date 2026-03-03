jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PageController } from './page.controller';

describe('PageController guardrails and mixed-id contract', () => {
  const pageService = {
    getSidebarPages: jest.fn(),
    movePage: jest.fn(),
    update: jest.fn(),
    forceDelete: jest.fn(),
    removePage: jest.fn(),
  };
  const pageRepo = {
    findById: jest.fn(),
    restorePage: jest.fn(),
  };
  const pageHistoryService = {};
  const spaceAbility = {
    createForUser: jest.fn(async () => ({ cannot: () => false })),
  };
  const collaborationGateway = {};
  const databaseRepo = {
    findByPageId: jest.fn(),
  };

  const controller = new PageController(
    pageService as any,
    pageRepo as any,
    pageHistoryService as any,
    spaceAbility as any,
    collaborationGateway as any,
    databaseRepo as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    pageService.getSidebarPages.mockResolvedValue({ items: [] });
    pageService.update.mockResolvedValue({ id: 'uuid-page', settings: null });
    pageRepo.findById.mockResolvedValue({
      id: 'uuid-page',
      slugId: 'docs-home',
      spaceId: 'space-a',
      workspaceId: 'workspace-1',
      content: null,
      settings: null,
      contributorIds: [],
    });
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
        {} as any,
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
    });
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
    });
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
  });
});
