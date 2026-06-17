import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { sanitizeLinkHref } from '@docmost/editor-ext';

describe('sanitizeLinkHref', () => {
  it('keeps safe absolute and relative links', () => {
    assert.equal(sanitizeLinkHref('https://example.com/page'), 'https://example.com/page');
    assert.equal(sanitizeLinkHref('/s/space/p/page-id'), '/s/space/p/page-id');
  });

  it('blocks script-like and data links', () => {
    assert.equal(sanitizeLinkHref('javascript:alert(1)'), '');
    assert.equal(sanitizeLinkHref('JaVaScRiPt:alert(1)'), '');
    assert.equal(sanitizeLinkHref('java\nscript:alert(1)'), '');
    assert.equal(sanitizeLinkHref('data:text/html,<script>alert(1)</script>'), '');
  });

  it('blocks protocol-relative links', () => {
    assert.equal(sanitizeLinkHref('//evil.example/phish'), '');
  });
});
