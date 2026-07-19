import { resolveHeadingNumberingEnabled } from './heading-numbering-settings.utils';

describe('resolveHeadingNumberingEnabled', () => {
  it('defaults to disabled', () => {
    expect(resolveHeadingNumberingEnabled(undefined)).toBe(false);
  });

  it('uses only the space setting', () => {
    expect(
      resolveHeadingNumberingEnabled({ headingNumbering: { enabled: true } }),
    ).toBe(true);
    expect(
      resolveHeadingNumberingEnabled({ headingNumbering: { enabled: false } }),
    ).toBe(false);
  });
});
