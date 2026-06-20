import { describe, expect, it } from 'vitest';
import { getRegex } from './search-and-replace';

describe('getRegex', () => {
  it('escapes special characters when regex mode is disabled', () => {
    const regex = getRegex('a+b?', true, true);

    expect('a+b?'.match(regex)?.[0]).toBe('a+b?');
    expect('aaab'.match(regex)).toBeNull();
  });

  it('keeps regex patterns when regex mode is enabled', () => {
    const regex = getRegex('a+b?', false, true);

    expect('aaab'.match(regex)?.[0]).toBe('aaab');
  });

  it('respects case sensitivity', () => {
    expect('Alpha'.match(getRegex('alpha', true, false))?.[0]).toBe('Alpha');
    expect('Alpha'.match(getRegex('alpha', true, true))).toBeNull();
  });
});
