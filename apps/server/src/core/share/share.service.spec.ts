import { NotFoundException } from '@nestjs/common';
import { ShareService } from './share.service';

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

    service = new ShareService(shareRepo as any, pageRepo as any, {} as any);
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
      workspaceId: 'workspace-1',
    });
    pageRepo.findById
      .mockResolvedValueOnce({
        id: 'page-1',
        slugId: 'root-slug',
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'page-1',
        slugId: 'root-slug',
        content: { type: 'doc', content: [] },
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
    });
    expect(result.share.id).toBe('share-1');
    expect(result.page.content).toEqual({ type: 'doc', content: [] });
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
