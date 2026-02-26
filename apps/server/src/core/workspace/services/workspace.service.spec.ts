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

  it('should prevent self-deactivation', async () => {
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

  it('should prevent an ADMIN from deactivating an OWNER', async () => {
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

  it('should prevent deactivating the last active owner', async () => {
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

  it('should deactivate a workspace member and emit an audit event', async () => {
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

  it('should reactivate a deactivated workspace member', async () => {
    const { service, userRepo, eventEmitter } = createService();

    userRepo.findById.mockResolvedValue({
      id: 'member-id',
      role: UserRole.MEMBER,
      deletedAt: null,
      deactivatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    userRepo.activeRoleCountByWorkspaceId.mockResolvedValue(2);

    await expect(
      service.deactivateUser(actor, 'member-id', workspaceId),
    ).resolves.toEqual({ success: true });

    expect(userRepo.updateUser).toHaveBeenCalledWith(
      { deactivatedAt: null },
      'member-id',
      workspaceId,
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
