import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Module,
  Post,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import * as request from 'supertest';
import { CsrfGuard } from '../src/common/guards/csrf.guard';
import { CsrfExempt } from '../src/common/decorators/csrf-exempt.decorator';

@Controller('auth')
class AuthTestController {
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  changePassword(@Body() _body: Record<string, unknown>) {
    return { ok: true };
  }

  /**
   * Архитектурное исключение: endpoint доступен без сессии,
   * поэтому CSRF-токен на этом шаге отсутствует.
   */
  @CsrfExempt()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login() {
    return { ok: true };
  }

  /**
   * Архитектурное исключение: forgot-password вызывается до аутентификации.
   */
  @CsrfExempt()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword() {
    return { ok: true };
  }

  /**
   * Архитектурное исключение: logout допускается без CSRF,
   * так как выполняет idempotent-очистку сессии и cookie.
   */
  @CsrfExempt()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout() {
    return { ok: true };
  }
}

@Controller('workspace')
class WorkspaceTestController {
  @HttpCode(HttpStatus.OK)
  @Post('update')
  updateWorkspace(@Body() _body: Record<string, unknown>) {
    return { ok: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/delete')
  deleteWorkspaceMember(@Body() _body: Record<string, unknown>) {
    return { ok: true };
  }
}

@Module({
  controllers: [AuthTestController, WorkspaceTestController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
class CsrfTestModule {}

describe('CSRF guard (integration)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CsrfTestModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.register(fastifyCookie);
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects POST /api/auth/change-password without CSRF token', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .send({ currentPassword: 'old', newPassword: 'new' })
      .expect(403);
  });

  it('rejects POST /api/workspace/update without CSRF token', async () => {
    await request(app.getHttpServer())
      .post('/api/workspace/update')
      .send({ name: 'new name' })
      .expect(403);
  });

  it('rejects POST /api/workspace/members/delete without CSRF token', async () => {
    await request(app.getHttpServer())
      .post('/api/workspace/members/delete')
      .send({ userId: 'user_1' })
      .expect(403);
  });

  it('allows mutating request with valid double-submit token', async () => {
    await request(app.getHttpServer())
      .post('/api/workspace/update')
      .set('Cookie', ['csrfToken=test-token'])
      .set('x-csrf-token', 'test-token')
      .send({ name: 'new name' })
      .expect(200);
  });

  it('keeps login/logout/forgot-password endpoints exempt from CSRF', async () => {
    await request(app.getHttpServer()).post('/api/auth/login').expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .expect(200);
    await request(app.getHttpServer()).post('/api/auth/logout').expect(200);
  });
});
