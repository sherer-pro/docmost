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

    expect(userRepo.updatePreference).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      'emailFrequency',
      '3h',
    );
    expect(userRepo.updateUser).not.toHaveBeenCalled();
    expect(result).toEqual(updatedPreferenceUser);
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

    expect(userRepo.updatePreference).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      'pushFrequency',
      '6h',
    );
    expect(userRepo.updateUser).not.toHaveBeenCalled();
    expect(result).toEqual(updatedPreferenceUser);
  });
});
