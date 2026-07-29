import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from './environment.service';

describe('EnvironmentService', () => {
  let service: EnvironmentService;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn((_key: string, defaultValue: unknown) => defaultValue);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnvironmentService,
        {
          provide: ConfigService,
          useValue: {
            get: configGet,
            getOrThrow: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EnvironmentService>(EnvironmentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('uses the production-safe AI stream idle timeout default', () => {
    expect(service.getAiStreamIdleTimeoutMs()).toBe(120000);
  });

  it('returns a configured AI stream idle timeout in range', () => {
    configGet.mockImplementation((key: string, defaultValue: unknown) =>
      key === 'AI_STREAM_IDLE_TIMEOUT_MS' ? '300000' : defaultValue,
    );

    expect(service.getAiStreamIdleTimeoutMs()).toBe(300000);
  });

  it.each(['4999', '600001', 'invalid'])(
    'falls back when AI stream idle timeout is invalid: %s',
    (value) => {
      configGet.mockImplementation((key: string, defaultValue: unknown) =>
        key === 'AI_STREAM_IDLE_TIMEOUT_MS' ? value : defaultValue,
      );

      expect(service.getAiStreamIdleTimeoutMs()).toBe(120000);
    },
  );
});
