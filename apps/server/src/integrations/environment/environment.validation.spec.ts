import { validate } from './environment.validation';
import { StartupConfigurationError } from '../../common/errors/startup.errors';

describe('Environment validation', () => {
  const validConfig = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://localhost:5432/docmost',
    REDIS_URL: 'redis://localhost:6379',
    APP_SECRET: 'a'.repeat(32),
    COLLAB_URL: 'http://localhost:3001',
    COLLAB_INTERNAL_URL: 'http://localhost:3001',
    COLLAB_INTERNAL_SECRET: 'b'.repeat(32),
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(['5000', '120000', '600000'])(
    'accepts an AI stream idle timeout in range: %s',
    (value) => {
      expect(
        validate({
          ...validConfig,
          AI_STREAM_IDLE_TIMEOUT_MS: value,
        }),
      ).toMatchObject({ AI_STREAM_IDLE_TIMEOUT_MS: value });
    },
  );

  it.each(['4999', '600001', 'invalid'])(
    'rejects an AI stream idle timeout outside the supported range: %s',
    (value) => {
      expect(() =>
        validate({
          ...validConfig,
          AI_STREAM_IDLE_TIMEOUT_MS: value,
        }),
      ).toThrow(StartupConfigurationError);
    },
  );

  it('accepts empty optional URL values forwarded by Compose', () => {
    expect(
      validate({
        ...validConfig,
        AWS_S3_ENDPOINT: '',
        AWS_S3_URL: '',
        DRAWIO_URL: '',
        POSTHOG_HOST: '',
      }),
    ).toMatchObject({
      AWS_S3_ENDPOINT: '',
      AWS_S3_URL: '',
      DRAWIO_URL: '',
      POSTHOG_HOST: '',
    });
  });

  it.each(['auto', 'external'])(
    'accepts database migration mode %s',
    (value) => {
      expect(
        validate({
          ...validConfig,
          DATABASE_MIGRATION_MODE: value,
        }),
      ).toMatchObject({ DATABASE_MIGRATION_MODE: value });
    },
  );

  it('rejects an unknown database migration mode', () => {
    expect(() =>
      validate({
        ...validConfig,
        DATABASE_MIGRATION_MODE: 'unsafe',
      }),
    ).toThrow(StartupConfigurationError);
  });
});
