import {
  Controller,
  Get,
  INestApplication,
  Module,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { SkipTransform } from '../decorators/skip-transform.decorator';
import { TransformHttpResponseInterceptor } from './http-response.interceptor';

@Controller('smoke')
class ResponseContractSmokeController {
  @Get('wrapped')
  wrapped() {
    return { message: 'ok' };
  }

  @SkipTransform()
  @Get('raw')
  raw() {
    return 'raw';
  }
}

@Module({
  controllers: [ResponseContractSmokeController],
})
class ResponseContractSmokeModule {}

describe('Response contract (smoke)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ResponseContractSmokeModule],
      providers: [Reflector],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalInterceptors(
      new TransformHttpResponseInterceptor(moduleFixture.get(Reflector)),
    );
    await app.init();
    await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps default endpoint responses into { data, success, status }', async () => {
    const response = await request(app.getHttpServer())
      .get('/smoke/wrapped')
      .expect(200);

    expect(response.body).toEqual({
      data: { message: 'ok' },
      success: true,
      status: 200,
    });
  });

  it('keeps raw payload for endpoints marked with @SkipTransform()', async () => {
    await request(app.getHttpServer()).get('/smoke/raw').expect(200).expect('raw');
  });
});
