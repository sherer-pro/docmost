import { sanitizeLogBindings } from './pino.config';

describe('sanitizeLogBindings', () => {
  it('removes SSO callback values and sensitive provider fields', () => {
    const bindings = {
      req: {
        url: '/api/sso/oidc/provider/callback?state=secret-state&code=secret-code',
      },
      err: {
        state: 'secret-state',
        code: 'secret-code',
        params: { state: 'nested-secret-state', code: 'nested-secret-code' },
        error: 'invalid_grant',
      },
    };

    sanitizeLogBindings([bindings]);

    expect(bindings).toEqual({
      req: { url: '/api/sso/oidc/provider/callback?state&code' },
      err: {
        state: '[Redacted]',
        code: '[Redacted]',
        params: '[Redacted]',
        error: 'invalid_grant',
      },
    });
  });
});
