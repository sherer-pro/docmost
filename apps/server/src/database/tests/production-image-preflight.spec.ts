import { isImmutableImageReference } from '../production-image-preflight';

describe('Production image preflight', () => {
  it('accepts only an image pinned by a complete sha256 digest', () => {
    expect(
      isImmutableImageReference(
        `registry.example.com/docmost:1.2.3@sha256:${'a'.repeat(64)}`,
      ),
    ).toBe(true);
    expect(isImmutableImageReference('docmost:latest')).toBe(false);
    expect(isImmutableImageReference('docmost@sha256:short')).toBe(false);
    expect(isImmutableImageReference(undefined)).toBe(false);
  });
});
