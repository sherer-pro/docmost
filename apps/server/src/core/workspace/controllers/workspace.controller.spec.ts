import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../../common/helpers/types/permission';

jest.mock('../services/workspace.service', () => ({
  WorkspaceService: class WorkspaceService {},
}));

import { WorkspaceController } from './workspace.controller';

describe('WorkspaceController', () => {
  const authUser = { id: 'admin-id', role: UserRole.ADMIN } as any;
  const workspace = { id: 'workspace-id' } as any;

  const createController = (canManageMembers = true) => {
    const workspaceService = {
      deactivateUser: jest.fn(),
    };

    const workspaceAbility = {
      createForUser: jest.fn().mockReturnValue({
        cannot: jest.fn().mockImplementation(() => !canManageMembers),
      }),
    };

    const controller = new WorkspaceController(
      workspaceService as any,
      {} as any,
      workspaceAbility as any,
      {} as any,
      {} as any,
    );

    return { controller, workspaceService };
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
});
