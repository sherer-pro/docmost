import {
  createCorsOriginValidator,
  getAllowedCorsOrigins,
} from './cors.util';

describe('cors.util', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getAllowedCorsOrigins', () => {
    it('uses the configured app and collab origins', () => {
      process.env.APP_URL = 'https://docs.example.com/path';
      process.env.COLLAB_URL = 'https://collab.example.com/api';

      expect(getAllowedCorsOrigins()).toEqual([
        'https://docs.example.com',
        'https://collab.example.com',
      ]);
    });

    it('falls back to localhost when no configured origin is valid', () => {
      process.env.APP_URL = 'not a url';
      delete process.env.COLLAB_URL;

      expect(getAllowedCorsOrigins()).toEqual(['http://localhost:3000']);
    });
  });

  describe('createCorsOriginValidator', () => {
    it('allows requests without an origin', () => {
      const callback = jest.fn();

      createCorsOriginValidator(['https://docs.example.com'])(
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('allows configured origins', () => {
      const callback = jest.fn();

      createCorsOriginValidator(['https://docs.example.com'])(
        'https://docs.example.com',
        callback,
      );

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('rejects unconfigured origins without throwing through the CORS hook', () => {
      const callback = jest.fn();

      createCorsOriginValidator(['https://docs.example.com'])(
        'chrome-extension://mpognobbkildjkofajifpdfhcoklimli',
        callback,
      );

      expect(callback).toHaveBeenCalledWith(null, false);
    });
  });
});
