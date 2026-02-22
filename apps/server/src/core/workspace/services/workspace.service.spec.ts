import { BadRequestException } from '@nestjs/common';
import { UserRole } from '../../../common/helpers/types/permission';
import { EventName } from '../../../common/events/event.contants';

jest.mock('../../space/services/space.service', () => ({
  SpaceService: class SpaceService {},
}));

import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  const workspaceId = 'workspace-id';
  const actor = { id: 'actor-id', role: UserRole.ADMIN } as any;

  const createService = () => {
    const userRepo = {
      findById: jest.fn(),
      activeRoleCountByWorkspaceId: jest.fn(),
      updateUser: jest.fn(),
    };

    const eventEmitter = {
      emit: jest.fn(),
    };

    const service = new WorkspaceService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      userRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      eventEmitter as any,
    );

    return { service, userRepo, eventEmitter };
  };

  it('должен запрещать self-deactivate', async () => {
    const { service, userRepo } = createService();

    userRepo.findById.mockResolvedValue({
      id: actor.id,
      role: UserRole.ADMIN,
      deletedAt: null,
      deactivatedAt: null,
    });

    await expect(
      service.deactivateUser(actor, actor.id, workspaceId),
    ).rejects.toThrow(new BadRequestException('You cannot deactivate yourself'));
  });

  it('должен запрещать ADMIN деактивировать OWNER', async () => {
    const { service, userRepo } = createService();

    userRepo.findById.mockResolvedValue({
      id: 'owner-id',
      role: UserRole.OWNER,
      deletedAt: null,
      deactivatedAt: null,
    });

    await expect(
      service.deactivateUser(actor, 'owner-id', workspaceId),
    ).rejects.toThrow(
      new BadRequestException('You cannot deactivate a user with owner role'),
    );
  });

  it('должен запрещать деактивацию последнего активного owner', async () => {
    const { service, userRepo } = createService();

    userRepo.findById.mockResolvedValue({
      id: 'owner-id',
      role: UserRole.OWNER,
      deletedAt: null,
      deactivatedAt: null,
    });
    userRepo.activeRoleCountByWorkspaceId.mockResolvedValue(1);

    await expect(
      service.deactivateUser(
        { id: 'another-owner', role: UserRole.OWNER } as any,
        'owner-id',
        workspaceId,
      ),
    ).rejects.toThrow(
      new BadRequestException('There must be at least one workspace owner'),
    );
  });

  it('должен деактивировать участника и отправлять audit-событие', async () => {
    const { service, userRepo, eventEmitter } = createService();

    userRepo.findById.mockResolvedValue({
      id: 'member-id',
      role: UserRole.MEMBER,
      deletedAt: null,
      deactivatedAt: null,
    });
    userRepo.activeRoleCountByWorkspaceId.mockResolvedValue(2);

    await expect(
      service.deactivateUser(actor, 'member-id', workspaceId),
    ).resolves.toEqual({ success: true });

    expect(userRepo.updateUser).toHaveBeenCalledWith(
      { deactivatedAt: expect.any(Date) },
      'member-id',
      workspaceId,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      EventName.WORKSPACE_MEMBER_DEACTIVATED,
      {
        workspaceId,
        userId: 'member-id',
        actorId: actor.id,
      },
    );
  });
});
