import { ForbiddenException, NotFoundException } from '@nestjs/common';
import SpaceAbilityFactory from './space-ability.factory';
import {
  SpaceRole,
  UserRole,
} from '../../../common/helpers/types/permission';

describe('SpaceAbilityFactory full space access', () => {
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
    spaceQuery.executeTakeFirst.mockResolvedValue({ id: 'space-1' });
    db.selectFrom.mockReturnValue(spaceQuery);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([]);
  });

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

function createUser(role: UserRole) {
  return {
    id: 'user-1',
    role,
    workspaceId: 'workspace-1',
  } as any;
}
