import {
  canonicalJsonString,
  hashCanonicalJson,
} from './canonical-json.util';

describe('canonical JSON', () => {
  it('ignores object-key insertion order at every depth', () => {
    const left = {
      content: 'same',
      selection: { from: 1, to: 2, meta: { b: true, a: false } },
    };
    const right = {
      selection: { meta: { a: false, b: true }, to: 2, from: 1 },
      content: 'same',
    };

    expect(canonicalJsonString(left)).toBe(canonicalJsonString(right));
    expect(hashCanonicalJson(left)).toBe(hashCanonicalJson(right));
  });

  it('keeps array order significant', () => {
    expect(hashCanonicalJson({ ids: ['a', 'b'] })).not.toBe(
      hashCanonicalJson({ ids: ['b', 'a'] }),
    );
  });

  it('matches JSON.stringify handling of undefined JSON members', () => {
    expect(canonicalJsonString({ value: undefined, keep: null })).toBe(
      '{"keep":null}',
    );
    expect(canonicalJsonString([undefined, null])).toBe('[null,null]');
  });
});
