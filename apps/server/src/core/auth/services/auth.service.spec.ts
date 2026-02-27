import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SignupService } from './signup.service';
import { TokenService } from './token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { UserTokenRepo } from '@docmost/db/repos/user-token/user-token.repo';
import { MailService } from '../../../integrations/mail/mail.service';
import { DomainService } from '../../../integrations/environment/domain.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SignupService, useValue: {} },
        { provide: TokenService, useValue: {} },
        { provide: UserRepo, useValue: {} },
        { provide: UserTokenRepo, useValue: {} },
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
});
