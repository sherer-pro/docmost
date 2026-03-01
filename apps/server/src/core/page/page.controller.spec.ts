jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PageController } from './page.controller';

describe('PageController guardrails', () => {
  const pageService = {
    getSidebarPages: jest.fn(),
    movePage: jest.fn(),
  };
  const pageRepo = { findById: jest.fn() };
  const pageHistoryService = {};
  const spaceAbility = {
    createForUser: jest.fn(async () => ({ cannot: () => false })),
  };
  const collaborationGateway = {};

  const controller = new PageController(
    pageService as any,
    pageRepo as any,
    pageHistoryService as any,
    spaceAbility as any,
    collaborationGateway as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    pageService.getSidebarPages.mockResolvedValue({ items: [] });
  });

  it('sidebar-pages rejects mismatched pageId/spaceId', async () => {
    pageRepo.findById.mockResolvedValue({ id: 'p1', spaceId: 'space-a', deletedAt: null });

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
      .mockResolvedValueOnce({ id: 'parent', spaceId: 'space-a', deletedAt: new Date() });

    await expect(
      controller.movePage(
        { pageId: 'p1', parentPageId: 'parent', position: 'aaaaa' } as any,
        { id: 'u1' } as any,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
