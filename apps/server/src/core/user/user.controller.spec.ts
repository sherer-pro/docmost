import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { UserRole } from '../../common/helpers/types/permission';

describe('UserController', () => {
  let controller: UserController;

  const userServiceMock = {
    update: jest.fn(),
  };

  const workspaceRepoMock = {
    getActiveUserCount: jest.fn(),
  };

  const userRepoMock = {
    hasNonDefaultGroupMembership: jest.fn(),
    getWorkspaceVisibleUsersCount: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: userServiceMock,
        },
        {
          provide: WorkspaceRepo,
          useValue: workspaceRepoMock,
        },
        {
          provide: UserRepo,
          useValue: userRepoMock,
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns visible member count for member users', async () => {
    const authUser = {
      id: 'member-user-id',
      role: UserRole.MEMBER,
    } as any;

    const workspace = {
      id: 'workspace-id',
      licenseKey: null,
    } as any;

    workspaceRepoMock.getActiveUserCount.mockResolvedValue(10);
    userRepoMock.getWorkspaceVisibleUsersCount.mockResolvedValue(2);
    userRepoMock.hasNonDefaultGroupMembership.mockResolvedValue(true);

    const result = await controller.getUserInfo(authUser, workspace);

    expect(userRepoMock.getWorkspaceVisibleUsersCount).toHaveBeenCalledWith(
      workspace.id,
      authUser,
    );
    expect(workspaceRepoMock.getActiveUserCount).not.toHaveBeenCalled();
    expect(result.workspace.memberCount).toBe(2);
  });

  it('returns global member count for admins and owners', async () => {
    const authUser = {
      id: 'admin-user-id',
      role: UserRole.ADMIN,
    } as any;

    const workspace = {
      id: 'workspace-id',
      licenseKey: 'license-key',
    } as any;

    workspaceRepoMock.getActiveUserCount.mockResolvedValue(10);
    userRepoMock.getWorkspaceVisibleUsersCount.mockResolvedValue(2);

    const result = await controller.getUserInfo(authUser, workspace);

    expect(workspaceRepoMock.getActiveUserCount).toHaveBeenCalledWith(
      workspace.id,
    );
    expect(userRepoMock.getWorkspaceVisibleUsersCount).not.toHaveBeenCalled();
    expect(result.workspace.memberCount).toBe(10);
    expect(result.workspace.hasLicenseKey).toBe(true);
  });
});
