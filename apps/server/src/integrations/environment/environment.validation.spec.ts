import { validate } from './environment.validation';

describe('Environment validation', () => {
  const validConfig = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://localhost:5432/docmost',
    REDIS_URL: 'redis://localhost:6379',
    APP_SECRET: 'a'.repeat(32),
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
      jest.spyOn(console, 'error').mockImplementation();
      jest.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      expect(() =>
        validate({
          ...validConfig,
          AI_STREAM_IDLE_TIMEOUT_MS: value,
        }),
      ).toThrow('process.exit');
      expect(console.error).toHaveBeenCalledWith(
        JSON.stringify({
          runtimeContract:
            'AI_STREAM_IDLE_TIMEOUT_MS must be an integer between 5000 and 600000',
        }),
      );
    },
  );
});
