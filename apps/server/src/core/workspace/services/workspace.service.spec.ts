import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UserRole } from '../../../common/helpers/types/permission';
import { EventName } from '../../../common/events/event.contants';
import { UpdateWorkspaceDto } from '../dto/update-workspace.dto';

jest.mock('../../space/services/space.service', () => ({
  SpaceService: class SpaceService {},
}));

import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  const workspaceId = 'workspace-id';
  const actor = { id: 'actor-id', role: UserRole.ADMIN } as any;

  const createService = (ssoEndpointAllowed = true) => {
    const workspaceRepo = {
      findById: jest.fn(),
      updateTagSettings: jest.fn(),
      updateWorkspace: jest.fn(),
    };
    const userRepo = {
      findById: jest.fn(),
      activeRoleCountByWorkspaceId: jest.fn(),
      updateUser: jest.fn(),
    };

    const eventEmitter = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue([]),
    };
    const ssoEndpointPolicy = {
      assertAllowed: ssoEndpointAllowed
        ? jest.fn().mockResolvedValue(new URL('https://idp.example.com'))
        : jest.fn().mockRejectedValue(new Error('Endpoint is not allowed')),
    };

    const service = new WorkspaceService(
      workspaceRepo as any,
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
      eventEmitter as any,
      ssoEndpointPolicy as any,
      {} as any,
    );

    return {
      service,
      workspaceRepo,
      userRepo,
      eventEmitter,
      ssoEndpointPolicy,
    };
  };

  it('requires an endpoint-policy-approved provider before SSO enforcement', async () => {
    const provider = {
      type: 'oidc',
      oidcIssuer: 'https://idp.example.com',
      oidcClientId: 'client-id',
      oidcClientSecret: 'encrypted-secret',
      verifiedAt: new Date(),
      lastSuccessfulLoginAt: new Date(),
    } as any;
    const allowed = createService(true);
    const denied = createService(false);

    await expect(
      (allowed.service as any).hasAllowedSsoProvider([provider]),
    ).resolves.toBe(true);
    await expect(
      (denied.service as any).hasAllowedSsoProvider([provider]),
    ).resolves.toBe(false);
    expect(allowed.ssoEndpointPolicy.assertAllowed).toHaveBeenCalledWith(
      provider.oidcIssuer,
      ['http:', 'https:'],
      'SSO provider',
    );
  });

  it('refuses SSO enforcement through a provider nobody has signed in with', async () => {
    const allowed = createService(true);
    const unverified = {
      type: 'oidc',
      oidcIssuer: 'https://idp.example.com',
      oidcClientId: 'client-id',
      oidcClientSecret: 'encrypted-secret',
      verifiedAt: null,
      lastSuccessfulLoginAt: null,
    } as any;
    const neverUsed = { ...unverified, verifiedAt: new Date() };

    await expect(
      (allowed.service as any).hasAllowedSsoProvider([unverified]),
    ).resolves.toBe(false);
    await expect(
      (allowed.service as any).hasAllowedSsoProvider([neverUsed]),
    ).resolves.toBe(false);
  });

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
    ).rejects.toThrow(
      new BadRequestException('You cannot deactivate yourself'),
    );
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

  it('should persist workspace tag settings', async () => {
    const { service, workspaceRepo } = createService();

    workspaceRepo.updateTagSettings.mockResolvedValue({});
    workspaceRepo.updateWorkspace.mockResolvedValue({});
    workspaceRepo.findById.mockResolvedValue({
      id: workspaceId,
      settings: {
        tags: {
          disabled: ['done'],
        },
      },
    });

    await expect(
      service.update(workspaceId, {
        tagSettings: {
          disabled: ['done'],
        },
      } as any),
    ).resolves.toMatchObject({
      id: workspaceId,
    });

    expect(workspaceRepo.updateTagSettings).toHaveBeenCalledWith(
      workspaceId,
      'disabled',
      ['done'],
    );
    expect(workspaceRepo.updateWorkspace).toHaveBeenCalledWith({}, workspaceId);
  });

  it('should validate workspace tag settings against built-in tags', () => {
    const validDto = plainToInstance(UpdateWorkspaceDto, {
      tagSettings: {
        disabled: ['done'],
      },
    });
    const invalidDto = plainToInstance(UpdateWorkspaceDto, {
      tagSettings: {
        disabled: ['missing'],
      },
    });

    expect(validateSync(validDto)).toHaveLength(0);
    expect(validateSync(invalidDto).length).toBeGreaterThan(0);
  });
});
