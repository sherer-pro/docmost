import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SignupService } from './signup.service';
import { TokenService } from './token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { UserTokenRepo } from '@docmost/db/repos/user-token/user-token.repo';
import { MailService } from '../../../integrations/mail/mail.service';
import { DomainService } from '../../../integrations/environment/domain.service';
import { UserTokenType } from '../auth.constants';
import { hashProtectedValue } from '../../../common/security/credential-protection.util';
import { BadRequestException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let userTokenRepo: { findById: jest.Mock };

  beforeEach(async () => {
    userTokenRepo = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SignupService, useValue: {} },
        { provide: TokenService, useValue: {} },
        { provide: UserRepo, useValue: {} },
        { provide: UserTokenRepo, useValue: userTokenRepo },
        { provide: MailService, useValue: {} },
        { provide: DomainService, useValue: {} },
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('verifyUserToken accepts hashed token records', async () => {
    const rawToken = 'raw-token';
    const hashedToken = hashProtectedValue(rawToken);

    userTokenRepo.findById.mockResolvedValueOnce({
      token: hashedToken,
      type: UserTokenType.FORGOT_PASSWORD,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.verifyUserToken(
        { token: rawToken, type: UserTokenType.FORGOT_PASSWORD } as any,
        'workspace-1',
      ),
    ).resolves.toBeUndefined();

    expect(userTokenRepo.findById).toHaveBeenCalledWith(
      hashedToken,
      'workspace-1',
    );
  });

  it('verifyUserToken keeps backward compatibility with legacy plaintext tokens', async () => {
    const rawToken = 'legacy-token';
    const hashedToken = hashProtectedValue(rawToken);

    userTokenRepo.findById
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        token: rawToken,
        type: UserTokenType.FORGOT_PASSWORD,
        expiresAt: new Date(Date.now() + 60_000),
      });

    await expect(
      service.verifyUserToken(
        { token: rawToken, type: UserTokenType.FORGOT_PASSWORD } as any,
        'workspace-1',
      ),
    ).resolves.toBeUndefined();

    expect(userTokenRepo.findById).toHaveBeenNthCalledWith(
      1,
      hashedToken,
      'workspace-1',
    );
    expect(userTokenRepo.findById).toHaveBeenNthCalledWith(
      2,
      rawToken,
      'workspace-1',
    );
  });

  it('verifyUserToken rejects missing tokens', async () => {
    const rawToken = 'missing-token';
    userTokenRepo.findById.mockResolvedValue(undefined);

    await expect(
      service.verifyUserToken(
        { token: rawToken, type: UserTokenType.FORGOT_PASSWORD } as any,
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
