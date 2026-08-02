jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import {
  AI_TOOL_RESULT_MAX_BYTES,
  fitAiToolItems,
} from './ai-tool-registry.service';

describe('fitAiToolItems', () => {
  it('keeps small tool results unchanged', () => {
    const items = [{ id: 'page-1', title: 'Page' }];

    expect(fitAiToolItems(items)).toEqual({ items, truncated: false });
  });

  it('truncates a large tree within the tool result byte limit', () => {
    const items = Array.from({ length: 500 }, (_, index) => ({
      id: `page-${index}`,
      parentPageId: null,
      title: `Page ${index} ${'x'.repeat(200)}`,
      slugId: `slug-${index}`,
      position: index,
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    }));

    const result = fitAiToolItems(items);

    expect(result.truncated).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(items.length);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(
      AI_TOOL_RESULT_MAX_BYTES,
    );
  });
});
