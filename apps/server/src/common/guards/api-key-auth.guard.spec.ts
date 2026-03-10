import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

describe('ApiKeyAuthGuard', () => {
  let guard: ApiKeyAuthGuard;

  beforeEach(() => {
    guard = new ApiKeyAuthGuard();
  });

  it('allows authenticated api_key principal', () => {
    const user = { authType: 'api_key' };

    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('rejects non-api-key principal', () => {
    expect(() => guard.handleRequest(null, { authType: 'access' })).toThrow(
      UnauthorizedException,
    );
  });
});
