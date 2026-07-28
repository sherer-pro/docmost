jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PageService } from './page.service';

const MOVED_PAGE_ID = '00000000-0000-4000-8000-000000000001';
const PARENT_PAGE_ID = '00000000-0000-4000-8000-000000000002';

describe('PageService move', () => {
  const pageRepo = {
    findById: jest.fn(),
    updatePage: jest.fn(),
    hasSelfOrAncestor: jest.fn(),
  };

  function createService() {
    return new PageService(
      pageRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  const movedPage = {
    id: MOVED_PAGE_ID,
    spaceId: 'space-1',
    parentPageId: null,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    pageRepo.findById.mockResolvedValue({
      id: PARENT_PAGE_ID,
      spaceId: 'space-1',
    });
  });

  it('moves the page when the new parent is not part of its own subtree', async () => {
    pageRepo.hasSelfOrAncestor.mockResolvedValue(false);

    await createService().movePage(
      { pageId: MOVED_PAGE_ID, parentPageId: PARENT_PAGE_ID, position: 'a1' },
      movedPage,
    );

    expect(pageRepo.hasSelfOrAncestor).toHaveBeenCalledWith(
      PARENT_PAGE_ID,
      MOVED_PAGE_ID,
    );
    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      { position: 'a1', parentPageId: PARENT_PAGE_ID },
      MOVED_PAGE_ID,
    );
  });

  it('rejects a move under the page own descendant to keep the tree acyclic', async () => {
    // The candidate parent already has the moved page among its ancestors.
    pageRepo.hasSelfOrAncestor.mockResolvedValue(true);

    await expect(
      createService().movePage(
        { pageId: MOVED_PAGE_ID, parentPageId: PARENT_PAGE_ID, position: 'a1' },
        movedPage,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('rejects a move under the page itself', async () => {
    pageRepo.findById.mockResolvedValue({
      id: MOVED_PAGE_ID,
      spaceId: 'space-1',
    });
    // `hasSelfOrAncestor` includes the page itself in the ancestor walk.
    pageRepo.hasSelfOrAncestor.mockResolvedValue(true);

    await expect(
      createService().movePage(
        { pageId: MOVED_PAGE_ID, parentPageId: MOVED_PAGE_ID, position: 'a1' },
        movedPage,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('rejects a move to a parent in another space', async () => {
    pageRepo.findById.mockResolvedValue({
      id: PARENT_PAGE_ID,
      spaceId: 'space-2',
    });

    await expect(
      createService().movePage(
        { pageId: MOVED_PAGE_ID, parentPageId: PARENT_PAGE_ID, position: 'a1' },
        movedPage,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageRepo.hasSelfOrAncestor).not.toHaveBeenCalled();
    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('skips the cycle check when the parent is unchanged', async () => {
    await createService().movePage(
      { pageId: MOVED_PAGE_ID, parentPageId: null, position: 'a1' },
      movedPage,
    );

    expect(pageRepo.hasSelfOrAncestor).not.toHaveBeenCalled();
    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      { position: 'a1', parentPageId: undefined },
      MOVED_PAGE_ID,
    );
  });
});
