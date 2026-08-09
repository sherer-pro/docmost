import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { PasswordResetDto } from './password-reset.dto';
import { ChangePasswordDto } from './change-password.dto';

describe('authentication input limits', () => {
  it('accepts 72 password bytes and rejects 73 bytes during login', async () => {
    const valid = plainToInstance(LoginDto, {
      email: 'user@example.test',
      password: 'é'.repeat(36),
    });
    const oversized = plainToInstance(LoginDto, {
      email: 'user@example.test',
      password: `${'é'.repeat(36)}a`,
    });

    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(oversized)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'password' }),
      ]),
    );
  });

  it('rejects oversized reset tokens before repository lookup', async () => {
    const dto = plainToInstance(PasswordResetDto, {
      token: 't'.repeat(513),
      newPassword: 'valid-password',
    });

    expect(await validate(dto)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'token' })]),
    );
  });

  it('applies the bcrypt byte limit to the current password too', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      oldPassword: 'é'.repeat(37),
      newPassword: 'valid-password',
    });

    expect(await validate(dto)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'oldPassword' }),
      ]),
    );
  });
});
