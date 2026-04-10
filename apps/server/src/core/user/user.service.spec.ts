import { UserService } from './user.service';

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
          pageEditMode: '"read"',
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
    expect(normalizedResult.settings.preferences.pageEditMode).toBe('read');
  });
});
