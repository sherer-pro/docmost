import { createHash } from 'node:crypto';
import {
  McpOAuthError,
  oauthHash,
  oauthRedirect,
  oauthSecret,
  oauthString,
  oauthUuid,
  oauthVerifier,
} from './mcp-oauth-validation';

describe('MCP OAuth validation', () => {
  it.each([
    'https://client.example/callback',
    'http://localhost:4701/callback',
    'http://127.0.0.1:4701/callback',
    'http://[::1]:4701/callback',
  ])('accepts an exact safe callback %s', (uri) => {
    expect(oauthRedirect(uri)).toBe(uri);
  });
  it.each([
    'javascript:alert(1)',
    'http://client.example/callback',
    'https://user:password@client.example/callback',
    'https://client.example/callback#fragment',
    'http://127.0.0.1.evil.example/callback',
    'https://client.example/\ncallback',
  ])('rejects unsafe callback %s', (uri) => {
    expect(() => oauthRedirect(uri)).toThrow(McpOAuthError);
  });
  it('requires a bounded S256 verifier and never accepts a challenge as the verifier', () => {
    const verifier = 'a'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(oauthVerifier(verifier, challenge)).toBe(true);
    expect(oauthVerifier(challenge, challenge)).toBe(false);
    expect(oauthVerifier('a'.repeat(42), challenge)).toBe(false);
    expect(oauthVerifier('a'.repeat(129), challenge)).toBe(false);
  });
  it('rejects duplicate query arrays, malformed IDs, controls and oversized names', () => {
    for (const value of [['one', 'two'], '', 'a'.repeat(121), 'App\u202ename'])
      expect(() => oauthString(value, 120)).toThrow();
    expect(() => oauthUuid('not-a-uuid')).toThrow();
    expect(oauthString(undefined, 120, true)).toBe('');
  });
  it('produces purpose-specific opaque tokens and stores only their hash', () => {
    const access = oauthSecret('dmoa');
    expect(access).toMatch(/^dmoa_[A-Za-z0-9_-]{43}$/);
    expect(oauthSecret('dmoa')).not.toBe(access);
    expect(oauthHash(access)).toMatch(/^[a-f0-9]{64}$/);
    expect(oauthHash(access)).not.toContain(access);
  });
});
