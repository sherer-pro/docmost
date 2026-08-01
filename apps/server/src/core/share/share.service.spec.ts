import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ShareService } from './share.service';

describe('ShareService public sharing invariants', () => {
  const createQuery = (result: unknown) => {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      forUpdate: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue(result),
    };
    return query;
  };

  const createService = (settings?: {
    workspace?: unknown;
    space?: unknown;
    existingShare?: unknown;
  }) => {
    const trx = {
      selectFrom: jest.fn((table: string) =>
        table === 'workspaces'
          ? createQuery({ id: 'workspace-1', settings: settings?.workspace })
          : createQuery({
              id: 'space-1',
              workspaceId: 'workspace-1',
              settings: settings?.space,
            }),
      ),
    };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (transaction: any) => unknown) => callback(trx),
      })),
    };
    const shareRepo = {
      findByPageId: jest.fn().mockResolvedValue(settings?.existingShare),
      insertShare: jest.fn().mockResolvedValue({ id: 'share-1' }),
    };
    const publicSharingPolicy = {
      isAllowedBySettings: jest.fn(
        (workspaceSettings: any, spaceSettings: any) =>
          workspaceSettings?.sharing?.disabled !== true &&
          spaceSettings?.sharing?.disabled !== true,
      ),
    };
    const service = new ShareService(
      shareRepo as any,
      {} as any,
      db as any,
      {} as any,
      publicSharingPolicy as any,
    );
    jest.spyOn(service as any, 'lockSharePage').mockResolvedValue(undefined);
    return { service, shareRepo, trx };
  };

  const createInput = {
    authUserId: 'user-1',
    workspaceId: 'workspace-1',
    page: { id: 'page-1', spaceId: 'space-1' } as any,
    createShareDto: {
      pageId: 'page-1',
      includeSubPages: false,
      searchIndexing: false,
    },
  };

  it('rechecks the locked workspace and space settings before insert', async () => {
    const { service, shareRepo } = createService({
      workspace: { sharing: { disabled: true } },
    });

    await expect(service.createShare(createInput)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(shareRepo.insertShare).not.toHaveBeenCalled();
  });

  it('returns the existing page share under the same lock', async () => {
    const existingShare = { id: 'existing-share' };
    const { service, shareRepo, trx } = createService({ existingShare });

    await expect(service.createShare(createInput)).resolves.toBe(existingShare);
    expect((service as any).lockSharePage).toHaveBeenCalledWith(
      trx,
      'page-1',
      'workspace-1',
      'space-1',
    );
    expect(shareRepo.findByPageId).toHaveBeenCalledWith('page-1', { trx });
    expect(shareRepo.insertShare).not.toHaveBeenCalled();
  });
});

describe('ShareService getSharedPage', () => {
  let service: ShareService;
  let shareRepo: { findById: jest.Mock };
  let pageRepo: { findBySlugId: jest.Mock; findById: jest.Mock };

  beforeEach(() => {
    shareRepo = {
      findById: jest.fn(),
    };
    pageRepo = {
      findBySlugId: jest.fn(),
      findById: jest.fn(),
    };
    service = new ShareService(
      shareRepo as any,
      pageRepo as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service, 'updatePublicAttachments')
      .mockResolvedValue({ type: 'doc', content: [] } as any);
  });

  it('passes expected shareId when pageId is provided', async () => {
    const getShareForPageSpy = jest
      .spyOn(service, 'getShareForPage')
      .mockResolvedValue(undefined);

    await expect(
      service.getSharedPage(
        { pageId: 'page-slug', shareId: 'share-key' } as any,
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(getShareForPageSpy).toHaveBeenCalledWith(
      'page-slug',
      'workspace-1',
      'share-key',
    );
    expect(pageRepo.findBySlugId).not.toHaveBeenCalled();
  });

  it('supports shareId-only lookup and returns shared page info', async () => {
    shareRepo.findById.mockResolvedValue({
      id: 'share-1',
      key: 'share-key',
      pageId: 'page-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
    });
    pageRepo.findById
      .mockResolvedValueOnce({
        id: 'page-1',
        slugId: 'root-slug',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'page-1',
        slugId: 'root-slug',
        content: { type: 'doc', content: [] },
        settings: { headingNumbering: { enabled: false } },
        space: {
          settings: {
            headingNumbering: { enabled: true },
            documentFields: { readingTime: true },
          },
        },
        deletedAt: null,
      });
    jest.spyOn(service, 'getShareForPage').mockResolvedValue({
      id: 'share-1',
      key: 'share-key',
      sharedPage: {
        id: 'page-1',
        slugId: 'root-slug',
        title: 'Root page',
        icon: null,
      },
    } as any);

    const result = await service.getSharedPage(
      { shareId: 'SHARE-KEY' } as any,
      'workspace-1',
    );

    expect(shareRepo.findById).toHaveBeenCalledWith('SHARE-KEY');
    expect(service.getShareForPage).toHaveBeenCalledWith(
      'root-slug',
      'workspace-1',
      'SHARE-KEY',
    );
    expect(pageRepo.findById).toHaveBeenNthCalledWith(1, 'page-1');
    expect(pageRepo.findById).toHaveBeenNthCalledWith(2, 'page-1', {
      includeContent: true,
      includeCreator: true,
      includeSpace: true,
    });
    expect(result.share.id).toBe('share-1');
    expect(result.page.content).toEqual({ type: 'doc', content: [] });
    expect(result.page).not.toHaveProperty('space');
    expect(result.headingNumberingEnabled).toBe(true);
    expect(result.readingTimeEnabled).toBe(true);
  });

  it('disables public reading time when the space setting is absent', async () => {
    shareRepo.findById.mockResolvedValue({
      id: 'share-1',
      key: 'share-key',
      pageId: 'page-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
    });
    pageRepo.findById
      .mockResolvedValueOnce({
        id: 'page-1',
        slugId: 'root-slug',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'page-1',
        slugId: 'root-slug',
        content: { type: 'doc', content: [] },
        settings: {},
        space: { settings: {} },
        deletedAt: null,
      });
    jest.spyOn(service, 'getShareForPage').mockResolvedValue({
      id: 'share-1',
      key: 'share-key',
    } as any);

    const result = await service.getSharedPage(
      { shareId: 'share-key' } as any,
      'workspace-1',
    );

    expect(result.readingTimeEnabled).toBe(false);
  });

  it('rejects shareId-only lookup when share belongs to another workspace', async () => {
    shareRepo.findById.mockResolvedValue({
      id: 'share-1',
      pageId: 'page-1',
      workspaceId: 'workspace-2',
    });

    await expect(
      service.getSharedPage({ shareId: 'share-1' } as any, 'workspace-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
