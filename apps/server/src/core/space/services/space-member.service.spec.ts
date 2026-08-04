import { SpaceMemberService } from './space-member.service';
import { SpaceRole } from '../../../common/helpers/types/permission';
import { executeTx } from '@docmost/db/utils';

jest.mock('@docmost/db/utils', () => ({
  executeTx: jest.fn(),
}));

describe('SpaceMemberService', () => {
  it('runs membership removal and watcher cleanup in the same transaction', async () => {
    const fakeDb = { kind: 'db' } as any;
    const fakeTrx = { kind: 'trx' } as any;

    const spaceMemberRepo = {
      getSpaceMemberByTypeId: jest.fn().mockResolvedValue({
        id: 'member-id',
        role: SpaceRole.WRITER,
      }),
      removeSpaceMemberById: jest.fn().mockResolvedValue(undefined),
    };

    const groupUserRepo = {};
    const spaceRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'space-id' }),
    };
    const watcherRepo = {
      deleteByUsersWithoutSpaceAccess: jest.fn().mockResolvedValue(undefined),
    };

    const service = new SpaceMemberService(
      spaceMemberRepo as any,
      groupUserRepo as any,
      spaceRepo as any,
      watcherRepo as any,
      {} as any,
      fakeDb,
    );

    (executeTx as jest.Mock).mockImplementation(async (_db, handler) =>
      handler(fakeTrx),
    );

    await service.removeMemberFromSpace(
      {
        spaceId: 'space-id',
        userId: 'user-id',
      } as any,
      'workspace-id',
    );

    expect(executeTx).toHaveBeenCalledWith(fakeDb, expect.any(Function));

    expect(spaceMemberRepo.removeSpaceMemberById).toHaveBeenCalledWith(
      'member-id',
      'space-id',
      { trx: fakeTrx },
    );

    expect(watcherRepo.deleteByUsersWithoutSpaceAccess).toHaveBeenCalledWith(
      ['user-id'],
      'space-id',
      { trx: fakeTrx },
    );
  });

  it('returns policy and requiresStepUp in the bootstrap space catalog', async () => {
    const spaceMemberRepo = {
      getUserSpaces: jest.fn().mockResolvedValue({
        items: [{ id: 'space-1', settings: {} }],
        hasNextPage: false,
      }),
    };
    const spacePolicy = {
      withPolicy: jest.fn((space) => ({
        ...space,
        policy: {
          overrides: {
            enforceMfa: null,
            enforceSso: true,
            disablePublicSharing: null,
          },
          effective: {
            enforceMfa: false,
            enforceSso: true,
            disablePublicSharing: false,
          },
        },
      })),
      evaluateAuthentication: jest.fn(() => ({ satisfied: false })),
    };
    const service = new SpaceMemberService(
      spaceMemberRepo as any,
      {} as any,
      {} as any,
      {} as any,
      spacePolicy as any,
      {} as any,
    );

    const result = await service.getUserSpaces(
      { id: 'user-1' } as any,
      { id: 'workspace-1' } as any,
      { id: 'session-1' } as any,
      {} as any,
    );

    expect(result.items[0]).toMatchObject({
      id: 'space-1',
      requiresStepUp: true,
      policy: {
        effective: { enforceSso: true },
      },
    });
  });
});
