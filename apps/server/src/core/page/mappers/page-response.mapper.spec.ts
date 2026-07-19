import { mapPageCustomFields } from './page-response.mapper';

describe('mapPageCustomFields AI role', () => {
  it.each([undefined, null, { aiRole: 'malformed' }])(
    'normalizes %p to NONE',
    (settings) => {
      expect(mapPageCustomFields({ settings }).aiRole).toBe('NONE');
    },
  );

  it('preserves a valid value', () => {
    expect(
      mapPageCustomFields({ settings: { aiRole: 'AUTHOR' } }).aiRole,
    ).toBe('AUTHOR');
  });
});
