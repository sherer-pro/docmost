import { resolveHeadingNumberingEnabled } from './heading-numbering-settings.utils';

describe('resolveHeadingNumberingEnabled', () => {
  it('defaults to disabled', () => {
    expect(resolveHeadingNumberingEnabled(undefined, undefined)).toBe(false);
  });

  it('inherits the space setting for missing and null overrides', () => {
    const spaceSettings = { headingNumbering: { enabled: true } };

    expect(resolveHeadingNumberingEnabled({}, spaceSettings)).toBe(true);
    expect(
      resolveHeadingNumberingEnabled(
        { headingNumbering: { enabled: null } },
        spaceSettings,
      ),
    ).toBe(true);
  });

  it('prefers explicit page overrides', () => {
    expect(
      resolveHeadingNumberingEnabled(
        { headingNumbering: { enabled: false } },
        { headingNumbering: { enabled: true } },
      ),
    ).toBe(false);
    expect(
      resolveHeadingNumberingEnabled(
        { headingNumbering: { enabled: true } },
        { headingNumbering: { enabled: false } },
      ),
    ).toBe(true);
  });
});
