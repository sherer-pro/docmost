import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcceptInviteDto } from './invitation.dto';

describe('AcceptInviteDto', () => {
  const createDto = (password: string) =>
    plainToInstance(AcceptInviteDto, {
      invitationId: '11111111-1111-4111-8111-111111111111',
      token: 'invite-token',
      name: 'Test User',
      password,
    });

  it('accepts a password at the bcrypt UTF-8 byte limit', async () => {
    await expect(
      validate(createDto('\u00e9'.repeat(36))),
    ).resolves.toHaveLength(0);
  });

  it('rejects a password beyond the bcrypt UTF-8 byte limit', async () => {
    const errors = await validate(createDto('\u00e9'.repeat(37)));

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'password',
          constraints: expect.objectContaining({
            maxUtf8Bytes: expect.any(String),
          }),
        }),
      ]),
    );
  });
});
