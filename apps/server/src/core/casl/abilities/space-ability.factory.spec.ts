import { ForbiddenException, NotFoundException } from '@nestjs/common';
import SpaceAbilityFactory from './space-ability.factory';
import {
  SpaceRole,
  UserRole,
} from '../../../common/helpers/types/permission';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../interfaces/space-ability.type';

describe('SpaceAbilityFactory', () => {
  const spaceMemberRepo = {
    getUserSpaceRoles: jest.fn(),
  };
  const spaceQuery = {
    select: jest.fn(),
    where: jest.fn(),
    executeTakeFirst: jest.fn(),
  };
  const db = {
    selectFrom: jest.fn(),
  };
  const factory = new SpaceAbilityFactory(spaceMemberRepo as any, db as any);

  beforeEach(() => {
    jest.clearAllMocks();
    spaceQuery.select.mockReturnValue(spaceQuery);
    spaceQuery.where.mockReturnValue(spaceQuery);
    spaceQuery.executeTakeFirst.mockResolvedValue({
      id: 'space-1',
      archivedAt: null,
      workspaceId: 'workspace-1',
    });
    db.selectFrom.mockReturnValue(spaceQuery);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([]);
  });

  describe('createForUser', () => {
    it.each([UserRole.OWNER, UserRole.ADMIN])(
      'grants workspace role %s settings access without page access',
      async (role) => {
        const ability = await factory.createForUser(
          createUser(role),
          'space-1',
        );

        expect(
          ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings),
        ).toBe(true);
        expect(
          ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Member),
        ).toBe(true);
        expect(
          ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Page),
        ).toBe(false);
        expect(
          ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Share),
        ).toBe(false);
      },
    );

    it('preserves writer page access when workspace admin rights are added', async () => {
      spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
        { userId: 'user-1', role: SpaceRole.WRITER },
      ]);

      const ability = await factory.createForUser(
        createUser(UserRole.ADMIN),
        'space-1',
      );

      expect(
        ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings),
      ).toBe(true);
      expect(
        ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Page),
      ).toBe(true);
    });

    it('keeps a space admin full access', async () => {
      spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
        { userId: 'user-1', role: SpaceRole.ADMIN },
      ]);

      const ability = await factory.createForUser(
        createUser(UserRole.MEMBER),
        'space-1',
      );

      expect(
        ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings),
      ).toBe(true);
      expect(
        ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Member),
      ).toBe(true);
      expect(
        ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Page),
      ).toBe(true);
      expect(
        ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Share),
      ).toBe(true);
    });

    it.each([SpaceRole.WRITER, SpaceRole.READER])(
      'keeps space role %s settings read-only',
      async (spaceRole) => {
        spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
          { userId: 'user-1', role: spaceRole },
        ]);

        const ability = await factory.createForUser(
          createUser(UserRole.MEMBER),
          'space-1',
        );

        expect(
          ability.can(SpaceCaslAction.Read, SpaceCaslSubject.Settings),
        ).toBe(true);
        expect(
          ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings),
        ).toBe(false);
      },
    );

    it('keeps page management disabled for archived spaces', async () => {
      spaceQuery.executeTakeFirst.mockResolvedValue({
        id: 'space-1',
        archivedAt: new Date(),
        workspaceId: 'workspace-1',
      });
      spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
        { userId: 'user-1', role: SpaceRole.WRITER },
      ]);

      const ability = await factory.createForUser(
        createUser(UserRole.ADMIN),
        'space-1',
      );

      expect(
        ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings),
      ).toBe(true);
      expect(
        ability.can(SpaceCaslAction.Read, SpaceCaslSubject.Page),
      ).toBe(true);
      expect(
        ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Page),
      ).toBe(false);
    });

    it('rejects members without a space role', async () => {
      await expect(
        factory.createForUser(createUser(UserRole.MEMBER), 'space-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not expose a missing or cross-workspace space', async () => {
      spaceQuery.executeTakeFirst.mockResolvedValue(null);

      await expect(
        factory.createForUser(
          createUser(UserRole.OWNER),
          'space-outside-workspace',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertHasFullSpaceAccess', () => {
    it.each([UserRole.OWNER, UserRole.ADMIN])(
      'allows workspace role %s without a space membership',
      async (role) => {
        await expect(
          factory.assertHasFullSpaceAccess(createUser(role), 'space-1'),
        ).resolves.toBeUndefined();

        expect(spaceMemberRepo.getUserSpaceRoles).not.toHaveBeenCalled();
      },
    );

    it('allows the highest admin role from direct or group memberships', async () => {
      spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
        { userId: 'user-1', role: SpaceRole.WRITER },
        { userId: 'user-1', role: SpaceRole.ADMIN },
      ]);

      await expect(
        factory.assertHasFullSpaceAccess(
          createUser(UserRole.MEMBER),
          'space-1',
        ),
      ).resolves.toBeUndefined();
    });

    it.each([SpaceRole.WRITER, SpaceRole.READER])(
      'rejects space role %s',
      async (role) => {
        spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
          { userId: 'user-1', role },
        ]);

        await expect(
          factory.assertHasFullSpaceAccess(
            createUser(UserRole.MEMBER),
            'space-1',
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it('does not expose a missing or cross-workspace space', async () => {
      spaceQuery.executeTakeFirst.mockResolvedValue(null);

      await expect(
        factory.assertHasFullSpaceAccess(
          createUser(UserRole.OWNER),
          'space-outside-workspace',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

function createUser(role: UserRole) {
  return {
    id: 'user-1',
    role,
    workspaceId: 'workspace-1',
  } as any;
}
