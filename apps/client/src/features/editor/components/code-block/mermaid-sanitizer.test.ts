import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeMermaidSvg } from './mermaid-sanitizer';

describe('sanitizeMermaidSvg', () => {
  it('preserves text inside foreignObject so Mermaid diagrams render correctly', () => {
    const payload =
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Node label</div></foreignObject></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('foreignObject'), true);
    assert.equal(sanitized.includes('Node label'), true);
  });

  it('returns the original SVG unchanged (intentional security relaxation for text rendering)', () => {
    const payload = '<svg><g onclick="alert(1)"><text>ok</text></g></svg>';

    assert.equal(sanitizeMermaidSvg(payload), payload);
  });
});
