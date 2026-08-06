jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { BadRequestException } from '@nestjs/common';
import { PageService } from './page.service';

const PAGE_ID = '00000000-0000-4000-8000-000000000001';

describe('PageService create', () => {
  const pageRepo = {
    findById: jest.fn(),
    insertPage: jest.fn(),
    getPageDepth: jest.fn(),
  };
  const userRepo = {
    updatePageEditModeByPageId: jest.fn(),
  };
  const generalQueue = {
    add: jest.fn(async () => undefined),
  };
  const pageAccessMutationService = {
    copyParentRulesToChild: jest.fn(),
  };
  const trxStub: any = new Proxy(function () {}, {
    get: (_target, property) =>
      property === 'then'
        ? undefined
        : property === 'execute' || property === 'executeTakeFirst'
          ? () => Promise.resolve([])
          : () => trxStub,
  });
  const db = {
    transaction: () => ({ execute: (callback: any) => callback(trxStub) }),
  };

  const service = new PageService(
    pageRepo as any,
    {} as any,
    db as any,
    {} as any,
    {} as any,
    generalQueue as any,
    {} as any,
    { emit: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    userRepo as any,
    {} as any,
    {} as any,
    pageAccessMutationService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service, 'nextPagePosition').mockResolvedValue('a0');
    pageRepo.getPageDepth.mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sets the creator page edit override to edit for a newly created page', async () => {
    pageRepo.insertPage.mockResolvedValue({
      id: PAGE_ID,
      title: '',
      slugId: 'slug-1',
      position: 'a0',
      parentPageId: null,
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });

    await service.create('user-1', 'ws-1', {
      spaceId: 'space-1',
      title: '',
    });

    expect(userRepo.updatePageEditModeByPageId).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      PAGE_ID,
      'edit',
    );
  });

  it('rejects a child whose depth would exceed the tree limit', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'parent-1',
      spaceId: 'space-1',
      deletedAt: null,
    });
    pageRepo.getPageDepth.mockResolvedValue(100);

    await expect(
      service.create('user-1', 'ws-1', {
        spaceId: 'space-1',
        parentPageId: 'parent-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(pageRepo.insertPage).not.toHaveBeenCalled();
  });

  it('allows a child whose depth is exactly the tree limit', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'parent-1',
      spaceId: 'space-1',
      deletedAt: null,
    });
    pageRepo.getPageDepth.mockResolvedValue(99);
    pageRepo.insertPage.mockResolvedValue({
      id: PAGE_ID,
      title: '',
      slugId: 'slug-1',
      position: 'a0',
      parentPageId: 'parent-1',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });

    await service.create('user-1', 'ws-1', {
      spaceId: 'space-1',
      parentPageId: 'parent-1',
    });

    expect(pageRepo.findById).toHaveBeenCalledWith('parent-1', {
      withLock: true,
      trx: trxStub,
    });
    expect(pageRepo.insertPage).toHaveBeenCalled();
    expect(pageAccessMutationService.copyParentRulesToChild).toHaveBeenCalled();
  });
});
