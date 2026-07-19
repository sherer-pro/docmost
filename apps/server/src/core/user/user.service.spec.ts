import { UserService } from './user.service';

const PAGE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_PAGE_ID = '00000000-0000-4000-8000-000000000002';

describe('UserService', () => {
  const createService = () => {
    const userRepo = {
      findById: jest.fn(),
      updatePreference: jest.fn(),
      findByEmail: jest.fn(),
      updateUser: jest.fn(),
    } as any;

    return {
      service: new UserService(userRepo),
      userRepo,
    };
  };

  it('updates email frequency through user preferences', async () => {
    const { service, userRepo } = createService();

    const workspace = { id: 'ws-1' } as any;
    const user = {
      id: 'user-1',
      email: 'john@example.com',
      password: 'hash',
    } as any;
    const updatedPreferenceUser = {
      ...user,
      settings: { preferences: { emailFrequency: '3h' } },
    };

    userRepo.findById
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(updatedPreferenceUser);
    userRepo.updatePreference.mockResolvedValue(updatedPreferenceUser);

    const result = await service.update(
      { emailFrequency: '3h' } as any,
      'user-1',
      workspace,
    );
    const normalizedResult = result as any;

    expect(userRepo.updatePreference).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      'emailFrequency',
      '3h',
    );
    expect(userRepo.updateUser).not.toHaveBeenCalled();
    expect(normalizedResult.settings.preferences.emailFrequency).toBe('3h');
  });

  it('updates push frequency through user preferences', async () => {
    const { service, userRepo } = createService();

    const workspace = { id: 'ws-1' } as any;
    const user = {
      id: 'user-1',
      email: 'john@example.com',
      password: 'hash',
    } as any;
    const updatedPreferenceUser = {
      ...user,
      settings: { preferences: { pushFrequency: '6h' } },
    };

    userRepo.findById
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(updatedPreferenceUser);
    userRepo.updatePreference.mockResolvedValue(updatedPreferenceUser);

    const result = await service.update(
      { pushFrequency: '6h' } as any,
      'user-1',
      workspace,
    );
    const normalizedResult = result as any;

    expect(userRepo.updatePreference).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      'pushFrequency',
      '6h',
    );
    expect(userRepo.updateUser).not.toHaveBeenCalled();
    expect(normalizedResult.settings.preferences.pushFrequency).toBe('6h');
  });

  it('updates page-level full width map through user preferences', async () => {
    const { service, userRepo } = createService();

    const workspace = { id: 'ws-1' } as any;
    const user = {
      id: 'user-1',
      email: 'john@example.com',
      password: 'hash',
    } as any;
    const fullPageWidthByPageId = {
      'page-1': true,
      'page-2': false,
    };
    const updatedPreferenceUser = {
      ...user,
      settings: { preferences: { fullPageWidthByPageId } },
    };

    userRepo.findById
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(updatedPreferenceUser);
    userRepo.updatePreference.mockResolvedValue(updatedPreferenceUser);

    const result = await service.update(
      { fullPageWidthByPageId } as any,
      'user-1',
      workspace,
    );
    const normalizedResult = result as any;

    expect(userRepo.updatePreference).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      'fullPageWidthByPageId',
      fullPageWidthByPageId,
    );
    expect(userRepo.updateUser).not.toHaveBeenCalled();
    expect(normalizedResult.settings.preferences.fullPageWidthByPageId).toEqual(
      fullPageWidthByPageId,
    );
  });

  it('updates and normalizes personal heading numbering overrides', async () => {
    const { service, userRepo } = createService();
    const workspace = { id: 'ws-1' } as any;
    const user = {
      id: 'user-1',
      email: 'john@example.com',
      password: 'hash',
      settings: { preferences: { rememberPageScrollPosition: true } },
    } as any;
    const headingNumberingByPageId = {
      [PAGE_ID]: false,
      [OTHER_PAGE_ID]: true,
      invalid: 'false',
    } as any;
    const normalizedOverrides = {
      [PAGE_ID]: false,
      [OTHER_PAGE_ID]: true,
    };
    const updatedUser = {
      ...user,
      settings: {
        preferences: {
          rememberPageScrollPosition: true,
          headingNumberingByPageId: normalizedOverrides,
        },
      },
    };

    userRepo.findById
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(updatedUser);
    userRepo.updatePreference.mockResolvedValue(updatedUser);

    const result = await service.update(
      { headingNumberingByPageId } as any,
      'user-1',
      workspace,
    );

    expect(userRepo.updatePreference).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      'headingNumberingByPageId',
      normalizedOverrides,
    );
    expect(userRepo.updateUser).not.toHaveBeenCalled();
    expect(
      (result as any).settings.preferences.headingNumberingByPageId,
    ).toEqual(normalizedOverrides);
    expect(
      (result as any).settings.preferences.rememberPageScrollPosition,
    ).toBe(true);
  });

  it('normalizes malformed page-width map and keeps only boolean entries', async () => {
    const { service, userRepo } = createService();

    const workspace = { id: 'ws-1' } as any;
    const user = {
      id: 'user-1',
      email: 'john@example.com',
      password: 'hash',
    } as any;
    const malformedMap = {
      '0': '{',
      '1': '"',
      '2': 'x',
      '3': '"',
      '4': ':',
      '5': 't',
      '6': 'r',
      '7': 'u',
      '8': 'e',
      '9': '}',
      'page-1': true,
    };
    const updatedPreferenceUser = {
      ...user,
      settings: { preferences: { fullPageWidthByPageId: { 'page-1': true } } },
    };

    userRepo.findById
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(updatedPreferenceUser);
    userRepo.updatePreference.mockResolvedValue(updatedPreferenceUser);

    const result = await service.update(
      { fullPageWidthByPageId: malformedMap } as any,
      'user-1',
      workspace,
    );
    const normalizedResult = result as any;

    expect(userRepo.updatePreference).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      'fullPageWidthByPageId',
      { 'page-1': true },
    );
    expect(normalizedResult.settings.preferences.fullPageWidthByPageId).toEqual({
      'page-1': true,
    });
  });

  it('updates page-level edit mode map through user preferences', async () => {
    const { service, userRepo } = createService();

    const workspace = { id: 'ws-1' } as any;
    const user = {
      id: 'user-1',
      email: 'john@example.com',
      password: 'hash',
    } as any;
    const pageEditModeByPageId = {
      [PAGE_ID]: 'edit',
      [OTHER_PAGE_ID]: '"read"',
      '00000000-0000-4000-8000-000000000003': 'invalid',
      'not-a-page-id': 'edit',
    };
    const normalizedPageEditModeByPageId = {
      [PAGE_ID]: 'edit',
      [OTHER_PAGE_ID]: 'read',
    };
    const updatedPreferenceUser = {
      ...user,
      settings: {
        preferences: { pageEditModeByPageId: normalizedPageEditModeByPageId },
      },
    };

    userRepo.findById
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(updatedPreferenceUser);
    userRepo.updatePreference.mockResolvedValue(updatedPreferenceUser);

    const result = await service.update(
      { pageEditModeByPageId } as any,
      'user-1',
      workspace,
    );
    const normalizedResult = result as any;

    expect(userRepo.updatePreference).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      'pageEditModeByPageId',
      normalizedPageEditModeByPageId,
    );
    expect(userRepo.updateUser).not.toHaveBeenCalled();
    expect(normalizedResult.settings.preferences.pageEditModeByPageId).toEqual(
      normalizedPageEditModeByPageId,
    );
  });

  it('normalizes quoted notification frequency payload before persisting', async () => {
    const { service, userRepo } = createService();

    const workspace = { id: 'ws-1' } as any;
    const user = {
      id: 'user-1',
      email: 'john@example.com',
      password: 'hash',
      settings: {
        preferences: {
          pushFrequency: 'immediate',
        },
      },
    } as any;
    const updatedPreferenceUser = {
      ...user,
      settings: { preferences: { pushFrequency: '24h' } },
    };

    userRepo.findById
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(updatedPreferenceUser);
    userRepo.updatePreference.mockResolvedValue(updatedPreferenceUser);

    const result = await service.update(
      { pushFrequency: '"24h"' } as any,
      'user-1',
      workspace,
    );
    const normalizedResult = result as any;

    expect(userRepo.updatePreference).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      'pushFrequency',
      '24h',
    );
    expect(normalizedResult.settings.preferences.pushFrequency).toBe('24h');
  });

  it('returns normalized preferences from findById', async () => {
    const { service, userRepo } = createService();
    const rawUser = {
      id: 'user-1',
      settings: {
        preferences: {
          pushEnabled: 'true',
          emailEnabled: '"false"',
          pushFrequency: '"24h"',
          emailFrequency: '"1h"',
          pageEditModeByPageId: {
            [PAGE_ID]: '"read"',
            [OTHER_PAGE_ID]: '"edit"',
            '00000000-0000-4000-8000-000000000003': 'invalid',
            'not-a-page-id': 'edit',
          },
        },
      },
    } as any;

    userRepo.findById.mockResolvedValue(rawUser);

    const result = await service.findById('user-1', 'ws-1');
    const normalizedResult = result as any;

    expect(normalizedResult.settings.preferences.pushEnabled).toBe(true);
    expect(normalizedResult.settings.preferences.emailEnabled).toBe(false);
    expect(normalizedResult.settings.preferences.pushFrequency).toBe('24h');
    expect(normalizedResult.settings.preferences.emailFrequency).toBe('1h');
    expect(normalizedResult.settings.preferences.pageEditModeByPageId).toEqual({
      [PAGE_ID]: 'read',
      [OTHER_PAGE_ID]: 'edit',
    });
  });
});
