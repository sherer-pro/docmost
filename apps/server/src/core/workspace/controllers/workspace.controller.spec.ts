import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../../common/helpers/types/permission';

jest.mock('../services/workspace.service', () => ({
  WorkspaceService: class WorkspaceService {},
}));

jest.mock('../services/workspace-invitation.service', () => ({
  WorkspaceInvitationService: class WorkspaceInvitationService {},
}));

import { WorkspaceController } from './workspace.controller';

describe('WorkspaceController', () => {
  const authUser = { id: 'admin-id', role: UserRole.ADMIN } as any;
  const workspace = { id: 'workspace-id', hostname: 'old-host' } as any;

  const createController = (canManageMembers = true) => {
    const workspaceService = {
      deactivateUser: jest.fn(),
      filterExistingWorkspaceUserIds: jest.fn(),
      update: jest.fn(),
    };

    const workspaceInvitationService = {
      acceptInvitation: jest.fn(),
    };

    const authCookieService = {
      setAuthCookies: jest.fn(),
      clearAuthCookies: jest.fn(),
    };

    const presenceService = {
      getWorkspaceMembersPresence: jest.fn(),
    };

    const workspaceAbility = {
      createForUser: jest.fn().mockReturnValue({
        cannot: jest.fn().mockImplementation(() => !canManageMembers),
      }),
    };

    const controller = new WorkspaceController(
      workspaceService as any,
      workspaceInvitationService as any,
      workspaceAbility as any,
      { isCloud: jest.fn().mockReturnValue(false) } as any,
      authCookieService as any,
      presenceService as any,
    );

    return {
      controller,
      workspaceService,
      workspaceInvitationService,
      authCookieService,
      presenceService,
    };
  };

  it('should forbid member deactivation without member-management permissions', async () => {
    const { controller } = createController(false);

    await expect(
      controller.deactivateWorkspaceMember(
        { userId: 'member-id' },
        authUser,
        workspace,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should call the service and return the explicit response contract', async () => {
    const { controller, workspaceService } = createController(true);

    workspaceService.deactivateUser.mockResolvedValue({ success: true });

    await expect(
      controller.deactivateWorkspaceMember(
        { userId: 'member-id' },
        authUser,
        workspace,
      ),
    ).resolves.toEqual({ success: true });

    expect(workspaceService.deactivateUser).toHaveBeenCalledWith(
      authUser,
      'member-id',
      workspace.id,
    );
  });

  it('should forbid member presence without member-management permissions', async () => {
    const { controller } = createController(false);

    await expect(
      controller.getWorkspaceMembersPresence('member-id', authUser, workspace),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should return grouped member presence for requested users', async () => {
    const { controller, presenceService, workspaceService } =
      createController(true);
    const response = {
      users: {
        'member-id': {
          isOnline: true,
          lastSeenAt: '2026-06-19T10:00:00.000Z',
          sessions: [],
        },
      },
    };
    workspaceService.filterExistingWorkspaceUserIds.mockResolvedValue([
      'member-id',
    ]);
    presenceService.getWorkspaceMembersPresence.mockResolvedValue(response);

    await expect(
      controller.getWorkspaceMembersPresence(
        'member-id, second-member-id, member-id',
        authUser,
        workspace,
      ),
    ).resolves.toEqual(response);

    expect(workspaceService.filterExistingWorkspaceUserIds).toHaveBeenCalledWith(
      workspace.id,
      ['member-id', 'second-member-id', 'member-id'],
    );
    expect(presenceService.getWorkspaceMembersPresence).toHaveBeenCalledWith(
      workspace.id,
      ['member-id'],
    );
  });

  it('should set auth cookies via unified service when invite is accepted', async () => {
    const { controller, workspaceInvitationService, authCookieService } =
      createController(true);
    const res = {} as any;

    workspaceInvitationService.acceptInvitation.mockResolvedValue({
      requiresLogin: false,
      authToken: 'token',
    });

    await expect(
      controller.acceptInvite(
        { invitationToken: 'invite' } as any,
        workspace,
        {} as any,
        res,
      ),
    ).resolves.toEqual({ requiresLogin: false });

    expect(authCookieService.setAuthCookies).toHaveBeenCalledWith(res, 'token');
  });

  it('should clear auth cookies via unified service on hostname change', async () => {
    const { controller, workspaceService, authCookieService } = createController(true);
    const res = {} as any;

    workspaceService.update.mockResolvedValue({
      hostname: 'new-host',
    });

    await controller.updateWorkspace(
      res,
      { hostname: 'new-host' } as any,
      authUser,
      workspace,
    );

    expect(authCookieService.clearAuthCookies).toHaveBeenCalledWith(res);
  });
});
