import { ShareController } from './share.controller';

describe('ShareController getShareForPage mixed-id lookup', () => {
  const shareService = {
    getShareForPage: jest.fn(),
  };
  const spaceAbility = {
    createForUser: jest.fn(async () => ({ cannot: () => false })),
  };
  const shareRepo = {};
  const pageRepo = {
    findById: jest.fn(),
  };
  const environmentService = {
    isCloud: jest.fn(() => false),
  };

  const controller = new ShareController(
    shareService as any,
    spaceAbility as any,
    shareRepo as any,
    pageRepo as any,
    environmentService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    pageRepo.findById.mockResolvedValue({
      id: 'page-uuid',
      slugId: 'renamed-page',
      spaceId: 'space-1',
    });
    shareService.getShareForPage.mockResolvedValue(undefined);
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
});
