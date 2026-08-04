import { Test, TestingModule } from '@nestjs/testing';
import { SpaceController } from './space.controller';
import { SpaceService } from './services/space.service';
import { SpaceMemberService } from './services/space-member.service';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { PageAccessService } from '../page-access/page-access.service';
import { SpacePolicyService } from '../space-policy/space-policy.service';

describe('SpaceController', () => {
  let controller: SpaceController;
  const mockSpaceService = {
    getSpaceInfo: jest.fn(),
    archiveSpace: jest.fn(),
    unarchiveSpace: jest.fn(),
  };
  const mockSpaceAbility = {
    createForUser: jest.fn(),
  };
  const mockSpaceMemberRepo = {
    getUserSpaceRoles: jest.fn(),
  };
  const mockPageAccessService = {
    hasAnyReadablePageInSpace: jest.fn(),
  };
  const mockSpacePolicy = {
    resolveAccessibleSpace: jest.fn(),
    evaluateAuthentication: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleBuilder = Test.createTestingModule({
      controllers: [SpaceController],
      providers: [
        { provide: SpaceService, useValue: mockSpaceService },
        { provide: SpaceMemberService, useValue: {} },
        { provide: SpaceMemberRepo, useValue: mockSpaceMemberRepo },
        { provide: SpaceAbilityFactory, useValue: mockSpaceAbility },
        { provide: WorkspaceAbilityFactory, useValue: {} },
        { provide: PageAccessService, useValue: mockPageAccessService },
        { provide: SpacePolicyService, useValue: mockSpacePolicy },
      ],
    }).overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) });

    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<SpaceController>(SpaceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('accepts string spaceId in GET /spaces/:spaceId without ParseUUIDPipe', () => {
    const metadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      SpaceController,
      'getSpace',
    );

    const paramEntry = Object.values(metadata ?? {}).find(
      (entry: any) => entry?.data === 'spaceId',
    ) as { pipes?: unknown[] } | undefined;

    expect(paramEntry).toBeDefined();
    expect(paramEntry?.pipes ?? []).toHaveLength(0);
  });

  it('passes slug through GET /spaces/:spaceId to getSpace service', async () => {
    const user = { id: 'user-1' } as any;
    const workspace = { id: 'workspace-1' } as any;
    const spaceId = 'general';

    const ability = {
      cannot: jest.fn().mockReturnValue(false),
      rules: [],
    };

    mockSpaceService.getSpaceInfo.mockResolvedValue({ id: 'space-1' });
    mockSpaceAbility.createForUser.mockResolvedValue(ability);
    mockSpaceMemberRepo.getUserSpaceRoles.mockResolvedValue([]);

    const result = await controller.getSpace(spaceId, user, workspace);

    expect(mockSpaceService.getSpaceInfo).toHaveBeenCalledWith(
      'general',
      'workspace-1',
    );
    expect(mockSpaceAbility.createForUser).toHaveBeenCalledWith(user, 'space-1');
    expect(ability.cannot).toHaveBeenCalledWith(
      SpaceCaslAction.Read,
      SpaceCaslSubject.Settings,
    );
    expect(result.membership.role).toBeNull();
  });

  it('returns a bootstrap policy context for an accessible target space', async () => {
    const user = { id: 'user-1' } as any;
    const workspace = { id: 'workspace-1' } as any;
    const policy = {
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
    };
    mockSpacePolicy.resolveAccessibleSpace.mockResolvedValue({
      space: { id: 'space-101', slug: 'target', name: 'Target' },
      policy,
    });
    mockSpacePolicy.evaluateAuthentication.mockReturnValue({
      satisfied: false,
    });

    await expect(
      controller.getSpacePolicyContext(
        { spaceSlug: 'target' },
        user,
        workspace,
        { raw: { userSession: { id: 'session-1' } } } as any,
      ),
    ).resolves.toEqual({
      id: 'space-101',
      slug: 'target',
      name: 'Target',
      policy,
      requiresStepUp: true,
    });
  });

  it('archives a space when user can manage settings', async () => {
    const user = { id: 'user-1' } as any;
    const workspace = { id: 'workspace-1' } as any;
    const ability = {
      cannot: jest.fn().mockReturnValue(false),
      rules: [],
    };
    mockSpaceAbility.createForUser.mockResolvedValue(ability);
    mockSpaceService.archiveSpace.mockResolvedValue({ id: 'space-1' });
    mockSpaceService.getSpaceInfo.mockResolvedValue({ id: 'space-1' });
    mockSpaceMemberRepo.getUserSpaceRoles.mockResolvedValue([]);

    await controller.archiveSpace('space-1', user, workspace);

    expect(mockSpaceAbility.createForUser).toHaveBeenCalledWith(
      user,
      'space-1',
    );
    expect(ability.cannot).toHaveBeenCalledWith(
      SpaceCaslAction.Manage,
      SpaceCaslSubject.Settings,
    );
    expect(mockSpaceService.archiveSpace).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
    );
    expect(mockSpaceService.getSpaceInfo).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
    );
  });

  it('unarchives a space when user can manage settings', async () => {
    const user = { id: 'user-1' } as any;
    const workspace = { id: 'workspace-1' } as any;
    const ability = {
      cannot: jest.fn().mockReturnValue(false),
      rules: [],
    };
    mockSpaceAbility.createForUser.mockResolvedValue(ability);
    mockSpaceService.unarchiveSpace.mockResolvedValue({ id: 'space-1' });
    mockSpaceService.getSpaceInfo.mockResolvedValue({ id: 'space-1' });
    mockSpaceMemberRepo.getUserSpaceRoles.mockResolvedValue([]);

    await controller.unarchiveSpace('space-1', user, workspace);

    expect(mockSpaceAbility.createForUser).toHaveBeenCalledWith(
      user,
      'space-1',
    );
    expect(ability.cannot).toHaveBeenCalledWith(
      SpaceCaslAction.Manage,
      SpaceCaslSubject.Settings,
    );
    expect(mockSpaceService.unarchiveSpace).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
    );
    expect(mockSpaceService.getSpaceInfo).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
    );
  });
});
