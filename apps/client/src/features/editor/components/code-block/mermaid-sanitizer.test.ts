import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('');
(globalThis as { window?: Window }).window = window as unknown as Window;
(globalThis as { document?: Document }).document = window.document;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sanitizeMermaidSvg } = require('./mermaid-sanitizer') as {
  sanitizeMermaidSvg: (svg: string) => string;
};

describe('sanitizeMermaidSvg', () => {
  it('удаляет javascript: ссылки из SVG', () => {
    const payload = '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('javascript:'), false);
    assert.equal(sanitized.includes('xlink:href="javascript:alert(1)"'), false);
  });

  it('удаляет inline event handlers из SVG-элементов', () => {
    const payload = '<svg><g onclick="alert(1)"><text>safe</text></g></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('onclick='), false);
    assert.equal(sanitized.includes('<g>'), true);
  });
});
