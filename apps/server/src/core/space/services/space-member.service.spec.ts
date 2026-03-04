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
});
