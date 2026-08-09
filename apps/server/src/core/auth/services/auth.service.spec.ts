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
import { SessionService } from '../../session/session.service';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { SpacePolicyService } from '../../space-policy/space-policy.service';

describe('AuthService', () => {
  let service: AuthService;
  let userTokenRepo: {
    findById: jest.Mock;
    insertUserToken: jest.Mock;
    consumeActiveToken: jest.Mock;
  };
  let userRepo: { findByEmail: jest.Mock };
  let spacePolicy: { resolveAccessibleTarget: jest.Mock };
  let mailService: { sendToQueue: jest.Mock };
  let signupService: { initialSetup: jest.Mock };
  let sessionService: { createSessionAndToken: jest.Mock };

  beforeEach(async () => {
    userTokenRepo = {
      findById: jest.fn(),
      insertUserToken: jest.fn(),
      consumeActiveToken: jest.fn(),
    };
    userRepo = { findByEmail: jest.fn() };
    spacePolicy = { resolveAccessibleTarget: jest.fn() };
    mailService = { sendToQueue: jest.fn() };
    signupService = { initialSetup: jest.fn() };
    sessionService = { createSessionAndToken: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SignupService, useValue: signupService },
        { provide: TokenService, useValue: {} },
        { provide: SessionService, useValue: sessionService },
        { provide: UserRepo, useValue: userRepo },
        { provide: UserTokenRepo, useValue: userTokenRepo },
        { provide: UserSessionRepo, useValue: {} },
        { provide: MailService, useValue: mailService },
        {
          provide: DomainService,
          useValue: { getUrl: () => 'https://docs.example.com' },
        },
        { provide: SpacePolicyService, useValue: spacePolicy },
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('passes setup request metadata to the created session', async () => {
    const request = { headers: { 'user-agent': 'browser' } } as any;
    signupService.initialSetup.mockResolvedValue({
      workspace: { id: 'workspace-1' },
      user: { id: 'user-1' },
    });
    sessionService.createSessionAndToken.mockResolvedValue('auth-token');

    await expect(service.setup({} as any, request)).resolves.toEqual({
      workspace: { id: 'workspace-1' },
      authToken: 'auth-token',
    });
    expect(sessionService.createSessionAndToken).toHaveBeenCalledWith(
      { id: 'user-1' },
      request,
    );
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

  it('verifyUserToken rejects legacy plaintext tokens after migration', async () => {
    const rawToken = 'legacy-token';
    const hashedToken = hashProtectedValue(rawToken);

    userTokenRepo.findById.mockResolvedValueOnce(undefined);

    await expect(
      service.verifyUserToken(
        { token: rawToken, type: UserTokenType.FORGOT_PASSWORD } as any,
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(userTokenRepo.findById).toHaveBeenCalledTimes(1);
    expect(userTokenRepo.findById).toHaveBeenCalledWith(
      hashedToken,
      'workspace-1',
    );
  });

  it('verifyUserToken rejects an already consumed token', async () => {
    const rawToken = 'consumed-token';
    userTokenRepo.findById.mockResolvedValueOnce({
      token: hashProtectedValue(rawToken),
      type: UserTokenType.FORGOT_PASSWORD,
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.verifyUserToken(
        { token: rawToken, type: UserTokenType.FORGOT_PASSWORD } as any,
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  it('does not issue a password reset for a target space that enforces SSO', async () => {
    userRepo.findByEmail.mockResolvedValue({
      id: 'user-1',
      workspaceId: 'workspace-1',
      deletedAt: null,
    });
    spacePolicy.resolveAccessibleTarget.mockResolvedValue({
      space: { id: 'space-1', slug: 'strict-space' },
      policy: { effective: { enforceSso: true } },
    });

    await service.forgotPassword(
      { email: 'user@example.com', spaceSlug: 'strict-space' },
      { id: 'workspace-1', enforceSso: false } as any,
    );

    expect(userTokenRepo.insertUserToken).not.toHaveBeenCalled();
    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });
});
