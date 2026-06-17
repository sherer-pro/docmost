// @vitest-environment jsdom

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { sanitizeMermaidSvg } from './mermaid-sanitizer';

describe('sanitizeMermaidSvg', () => {
  it('preserves text inside foreignObject so Mermaid diagrams render correctly', () => {
    const payload =
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Node label</div></foreignObject></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('foreignObject'), true);
    assert.equal(sanitized.includes('Node label'), true);
  });

  it('removes event handlers and script tags from SVG payloads', () => {
    const payload =
      '<svg><script>alert(1)</script><g onclick="alert(2)"><text>safe</text></g></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('<script'), false);
    assert.equal(sanitized.includes('onclick='), false);
    assert.equal(sanitized.includes('safe'), true);
  });

  it('blocks javascript URLs in links', () => {
    const payload =
      '<svg><a href="javascript:alert(1)"><text>Node</text></a></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('javascript:'), false);
    assert.equal(sanitized.includes('Node'), true);
  });

  it('blocks javascript URLs in xlink:href attributes', () => {
    const payload =
      '<svg><a xlink:href="javascript:alert(1)"><text>Node</text></a></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('javascript:'), false);
    assert.equal(sanitized.includes('xlink:href='), false);
  });

  it('strips style attributes with expression() payloads', () => {
    const payload =
      '<svg><g style="color:red; width: expression(alert(1))"><text>Node</text></g></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('expression('), false);
    assert.equal(sanitized.includes('style='), false);
  });

  it('strips style attributes with url() payloads', () => {
    const payload =
      '<svg><g style="fill: url(javascript:alert(1))"><text>Node</text></g></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('url('), false);
    assert.equal(sanitized.includes('style='), false);
    assert.equal(sanitized.includes('Node'), true);
  });

  it('blocks svg data URLs and blob URLs in link attributes', () => {
    const payload =
      '<svg>' +
      '<a href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+"><text>SVG data</text></a>' +
      '<image href="blob:https://docmost.local/unsafe"></image>' +
      '</svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('data:image/svg+xml'), false);
    assert.equal(sanitized.includes('blob:'), false);
    assert.equal(sanitized.includes('SVG data'), true);
  });

  it('allows bitmap data URLs', () => {
    const payload =
      '<svg><image href="data:image/png;base64,iVBORw0KGgo="></image></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('data:image/png'), true);
  });

  it('blocks protocol-relative URLs', () => {
    const payload =
      '<svg><a href="//evil.example/phish"><text>Node</text></a></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('//evil.example'), false);
    assert.equal(sanitized.includes('Node'), true);
  });

  it('keeps labels when SVG is only parseable through HTML fallback', () => {
    const payload =
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span>Label<br></span></div></foreignObject></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('Label'), true);
    assert.equal(sanitized.includes('foreignObject'), true);
  });
});

