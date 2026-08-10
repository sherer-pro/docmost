import { GroupUserService } from './group-user.service';
import { EventName } from '../../../common/events/event.contants';

describe('GroupUserService', () => {
  it('removes inaccessible watchers in the membership transaction', async () => {
    const trx = { kind: 'transaction' };
    const db = {
      transaction: () => ({
        execute: (callback: (value: unknown) => unknown) => callback(trx),
      }),
    };
    const groupUserRepo = {
      getGroupUserById: jest.fn().mockResolvedValue({ id: 'membership-id' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const spaceMemberRepo = {
      getSpaceIdsByGroupId: jest.fn().mockResolvedValue(['space-id']),
    };
    const userRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'user-id' }),
    };
    const groupRepo = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'group-id',
        isDefault: false,
      }),
    };
    const watcherRepo = {
      deleteByUsersWithoutSpaceAccess: jest.fn().mockResolvedValue(undefined),
    };
    const eventEmitter = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue([]),
    };

    const service = new GroupUserService(
      groupUserRepo as any,
      spaceMemberRepo as any,
      userRepo as any,
      groupRepo as any,
      watcherRepo as any,
      db as any,
      eventEmitter as any,
    );

    await service.removeUserFromGroup('user-id', 'group-id', 'workspace-id');

    expect(groupRepo.findByIdOrThrow).toHaveBeenCalledWith(
      'group-id',
      'workspace-id',
    );
    expect(groupUserRepo.delete).toHaveBeenCalledWith('user-id', 'group-id', {
      trx,
    });
    expect(watcherRepo.deleteByUsersWithoutSpaceAccess).toHaveBeenCalledWith(
      ['user-id'],
      'space-id',
      { trx },
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      EventName.PAGE_EMBED_VISIBILITY_CHANGED,
      { workspaceId: 'workspace-id', accessUserIds: ['user-id'] },
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      EventName.AUTHORIZATION_CHANGED,
      { workspaceId: 'workspace-id', userId: 'user-id' },
    );
  });
});
