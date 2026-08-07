import { ShareController } from './share.controller';
import {
  getAttachmentTokenCookieName,
  LEGACY_ATTACHMENT_TOKEN_COOKIE,
} from '../attachment/attachment-public-token.util';

describe('ShareController', () => {
  const shareService = {
    getShareForPage: jest.fn(),
    getSharedPage: jest.fn(),
    isSharingAllowed: jest.fn(),
    lookupTransclusionForShare: jest.fn(),
  };
  const shareRepo = {
    findById: jest.fn(),
  };
  const pageRepo = {
    findById: jest.fn(),
  };
  const environmentService = {
    isCloud: jest.fn(() => false),
    isHttps: jest.fn(() => false),
  };
  const tokenService = {
    generateAttachmentPageToken: jest.fn(),
  };
  const pageAccessService = {
    assertCanMoveDeleteShare: jest.fn(async () => ({
      capabilities: {
        canMoveDeleteShare: true,
      },
    })),
  };

  const controller = new ShareController(
    shareService as any,
    shareRepo as any,
    pageRepo as any,
    environmentService as any,
    tokenService as any,
    pageAccessService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    pageRepo.findById.mockResolvedValue({
      id: 'page-uuid',
      slugId: 'renamed-page',
      spaceId: 'space-1',
    });
    shareService.getShareForPage.mockResolvedValue(undefined);
    shareService.getSharedPage.mockResolvedValue({
      page: {
        id: 'page-uuid',
      },
      share: {
        id: 'share-1',
        spaceId: 'space-1',
      },
    });
    shareService.isSharingAllowed.mockResolvedValue(true);
    tokenService.generateAttachmentPageToken.mockResolvedValue('token-1');
    shareRepo.findById.mockResolvedValue({
      id: 'share-1',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      sharedPage: { id: 'page-uuid' },
    });
  });

  it('resolves UUID input through findById and requests share by canonical slugId', async () => {
    await controller.getShareForPage(
      { pageId: 'page-uuid' } as any,
      { id: 'user-1' } as any,
      { id: 'workspace-1' } as any,
    );

    expect(pageRepo.findById).toHaveBeenCalledWith('page-uuid');
    expect(shareService.getShareForPage).toHaveBeenCalledWith(
      'renamed-page',
      'workspace-1',
    );
  });

  it('sets page-scoped and legacy attachment token cookies for shared page access', async () => {
    const res = {
      setCookie: jest.fn(),
      header: jest.fn(),
    };

    await controller.getSharedPageInfo(
      { pageId: 'page-uuid' } as any,
      {
        id: 'workspace-1',
      } as any,
      res as any,
    );

    expect(tokenService.generateAttachmentPageToken).toHaveBeenCalledWith({
      pageId: 'page-uuid',
      workspaceId: 'workspace-1',
      shareId: 'share-1',
    });

    expect(res.setCookie).toHaveBeenCalledWith(
      getAttachmentTokenCookieName('page-uuid'),
      'token-1',
      expect.objectContaining({
        httpOnly: true,
        path: '/api',
        sameSite: 'lax',
        secure: false,
      }),
    );
    expect(res.setCookie).toHaveBeenCalledWith(
      LEGACY_ATTACHMENT_TOKEN_COOKIE,
      'token-1',
      expect.objectContaining({
        httpOnly: true,
        path: '/api',
      }),
    );
  });

  it('sets and clears page-scoped cookies for public synced blocks', async () => {
    shareService.lookupTransclusionForShare.mockResolvedValueOnce({
      items: [
        {
          sourcePageId: 'source-readable',
          transclusionId: 'block-readable',
          content: { type: 'doc', content: [] },
        },
        {
          sourcePageId: 'source-hidden',
          transclusionId: 'block-hidden',
          status: 'no_access',
        },
      ],
    });
    const res = {
      setCookie: jest.fn(),
      clearCookie: jest.fn(),
      header: jest.fn(),
    };

    await controller.lookupTransclusion(
      {
        shareId: 'share-1',
        references: [
          {
            sourcePageId: 'source-readable',
            transclusionId: 'block-readable',
          },
          {
            sourcePageId: 'source-hidden',
            transclusionId: 'block-hidden',
          },
        ],
      } as any,
      { id: 'workspace-1' } as any,
      res as any,
    );

    expect(res.setCookie).toHaveBeenCalledWith(
      getAttachmentTokenCookieName('source-readable'),
      'token-1',
      expect.objectContaining({ httpOnly: true, path: '/api' }),
    );
    expect(tokenService.generateAttachmentPageToken).toHaveBeenCalledWith({
      pageId: 'source-readable',
      workspaceId: 'workspace-1',
      shareId: 'share-1',
    });
    expect(res.setCookie).not.toHaveBeenCalledWith(
      LEGACY_ATTACHMENT_TOKEN_COOKIE,
      expect.anything(),
      expect.anything(),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      getAttachmentTokenCookieName('source-hidden'),
      expect.objectContaining({ path: '/api' }),
    );
  });

  it('rejects a public share that belongs to another workspace', async () => {
    shareRepo.findById.mockResolvedValueOnce({
      id: 'share-foreign',
      workspaceId: 'workspace-2',
      spaceId: 'space-2',
      sharedPage: { id: 'page-foreign' },
    });
    const res = { header: jest.fn() };

    await expect(
      controller.getShare(
        { shareId: 'share-foreign' },
        { id: 'workspace-1' } as any,
        res as any,
      ),
    ).rejects.toThrow('Share not found');

    expect(shareService.isSharingAllowed).not.toHaveBeenCalled();
  });

  it('marks public share data as non-cacheable', async () => {
    const res = { header: jest.fn() };

    await controller.getShare(
      { shareId: 'share-1' },
      { id: 'workspace-1' } as any,
      res as any,
    );

    expect(res.header).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(res.header).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.header).toHaveBeenCalledWith('Expires', '0');
  });
});
