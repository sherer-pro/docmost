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
  };
  const shareRepo = {};
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
    };

    await controller.getSharedPageInfo(
      { pageId: 'page-uuid' } as any,
      {
        id: 'workspace-1',
        licenseKey: null,
        plan: 'free',
      } as any,
      res as any,
    );

    expect(tokenService.generateAttachmentPageToken).toHaveBeenCalledWith({
      pageId: 'page-uuid',
      workspaceId: 'workspace-1',
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
});
