import {
  createCorsOriginValidator,
  getAllowedCorsOrigins,
  createApplicationCorsOptions,
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

  it('permits bearer-only OAuth and MCP browser transport without opening account APIs', () => {
    const delegate = createApplicationCorsOptions();
    for (const path of ['/mcp', '/api/mcp-oauth/token', '/.well-known/oauth-protected-resource/mcp']) {
      const callback = jest.fn();
      delegate({ url: path }, callback);
      expect(callback.mock.calls[0][1]).toMatchObject({ origin: '*', credentials: false });
    }
    for (const path of ['/api/mcp-oauth/account/consent', '/api/pages', '/mcp/anything']) {
      const callback = jest.fn();
      delegate({ url: path }, callback);
      expect(callback.mock.calls[0][1].credentials).toBe(true);
      expect(typeof callback.mock.calls[0][1].origin).toBe('function');
    }
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
