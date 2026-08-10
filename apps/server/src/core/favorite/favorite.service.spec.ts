import { FavoriteType } from '@docmost/db/repos/favorite/favorite.repo';
import { FavoriteService } from './favorite.service';

describe('FavoriteService', () => {
  const favoriteRepo = {
    getFavoriteIds: jest.fn(),
    findPagesByIds: jest.fn(),
  };
  const pageAccessService = {
    getEffectiveAccessForPages: jest.fn(),
  };
  const spaceMemberRepo = {
    getUserSpaceIds: jest.fn(),
  };
  const user = {
    id: 'user-1',
    workspaceId: 'workspace-1',
    role: 'member',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not expose deleted or restricted page ids after access changes', async () => {
    favoriteRepo.getFavoriteIds.mockResolvedValue({
      items: ['allowed-page', 'deleted-page', 'restricted-page'],
      meta: { hasNextPage: false },
    });
    const pages = [
      {
        id: 'allowed-page',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        deletedAt: null,
      },
      {
        id: 'deleted-page',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        deletedAt: new Date(),
      },
      {
        id: 'restricted-page',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        deletedAt: null,
      },
    ];
    favoriteRepo.findPagesByIds.mockResolvedValue(pages);
    pageAccessService.getEffectiveAccessForPages.mockResolvedValue(
      new Map([
        ['allowed-page', { capabilities: { canRead: true } }],
        ['deleted-page', { capabilities: { canRead: true } }],
        ['restricted-page', { capabilities: { canRead: false } }],
      ]),
    );
    const service = new FavoriteService(
      favoriteRepo as any,
      pageAccessService as any,
      spaceMemberRepo as any,
    );

    const result = await service.getFavoriteIds(
      user,
      user.workspaceId,
      FavoriteType.PAGE,
    );

    expect(result.items).toEqual(['allowed-page']);
    expect(favoriteRepo.findPagesByIds).toHaveBeenCalledWith([
      'allowed-page',
      'deleted-page',
      'restricted-page',
    ]);
    expect(pageAccessService.getEffectiveAccessForPages).toHaveBeenCalledWith(
      pages,
      user,
    );
  });
});
