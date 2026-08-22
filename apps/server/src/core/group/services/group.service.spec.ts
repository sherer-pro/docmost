import { Test, TestingModule } from '@nestjs/testing';
import { GroupService } from './group.service';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { GroupUserService } from './group-user.service';
import { WatcherRepo } from '@docmost/db/repos/watcher/watcher.repo';
import { EventName } from '../../../common/events/event.contants';

describe('GroupService', () => {
  let service: GroupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupService,
        { provide: GroupRepo, useValue: {} },
        { provide: GroupUserRepo, useValue: {} },
        { provide: SpaceMemberRepo, useValue: {} },
        { provide: GroupUserService, useValue: {} },
        { provide: WatcherRepo, useValue: {} },
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
      ],
    }).compile();

    service = module.get<GroupService>(GroupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('invalidates active authorization after deleting an access-bearing group', async () => {
    const trx = { kind: 'transaction' };
    const db = {
      transaction: () => ({
        execute: (callback: (value: unknown) => unknown) => callback(trx),
      }),
    };
    const groupRepo = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'group-id',
        isDefault: false,
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const groupUserRepo = {
      getUserIdsByGroupId: jest
        .fn()
        .mockResolvedValue(['user-id', 'user-id', 'second-user-id']),
    };
    const spaceMemberRepo = {
      getSpaceIdsByGroupId: jest
        .fn()
        .mockResolvedValue(['space-id', 'second-space-id']),
    };
    const watcherRepo = {
      deleteByUsersWithoutSpacesAccess: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    const eventEmitter = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue([]),
    };

    const groupService = new GroupService(
      groupRepo as any,
      groupUserRepo as any,
      spaceMemberRepo as any,
      {} as any,
      watcherRepo as any,
      db as any,
      eventEmitter as any,
    );

    await groupService.deleteGroup('group-id', 'workspace-id');

    expect(groupRepo.delete).toHaveBeenCalledWith('group-id', 'workspace-id', {
      trx,
    });
    expect(watcherRepo.deleteByUsersWithoutSpacesAccess).toHaveBeenCalledWith(
      ['user-id', 'user-id', 'second-user-id'],
      ['space-id', 'second-space-id'],
      { trx },
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(2);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      EventName.AUTHORIZATION_CHANGED,
      { workspaceId: 'workspace-id', userId: 'user-id' },
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      EventName.AUTHORIZATION_CHANGED,
      { workspaceId: 'workspace-id', userId: 'second-user-id' },
    );
  });
});
