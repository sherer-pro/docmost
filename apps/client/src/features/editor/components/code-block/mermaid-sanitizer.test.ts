import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeMermaidSvg } from './mermaid-sanitizer';

describe('sanitizeMermaidSvg', () => {
  it('сохраняет текст внутри foreignObject, чтобы Mermaid-диаграммы отображались корректно', () => {
    const payload =
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Текст узла</div></foreignObject></svg>';

    const sanitized = sanitizeMermaidSvg(payload);

    assert.equal(sanitized.includes('foreignObject'), true);
    assert.equal(sanitized.includes('Текст узла'), true);
  });

  it('возвращает исходный SVG без изменений (осознанное ослабление защиты ради рендера текста)', () => {
    const payload = '<svg><g onclick="alert(1)"><text>ok</text></g></svg>';

    assert.equal(sanitizeMermaidSvg(payload), payload);
  });
});
