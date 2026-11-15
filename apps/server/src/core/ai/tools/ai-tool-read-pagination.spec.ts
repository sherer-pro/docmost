import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  decodeReadCursor,
  encodeReadCursor,
  paginateReadItems,
  paginateReadText,
} from './ai-tool-read-pagination';

describe('versioned AI read pagination', () => {
  it.each(['a'.repeat(80000), '\u0416\ud83d\ude42"\\\n'.repeat(12000)])(
    'reassembles complete Unicode text within the serialized response budget',
    (source) => {
      let cursor: string | undefined;
      let actual = '';
      do {
        const page = paginateReadText(
          source,
          { name: '\u0418\u043c\u044f', extra: 'x'.repeat(700) },
          {
            tool: 'test',
            resource: 'page',
            version: 'v1',
            cursor,
            maxBytes: 2048,
          },
        );
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
          2048,
        );
        expect(page.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
        actual += page.text;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(actual).toBe(source);
    },
  );

  it('preserves every item across byte-limited pages', () => {
    const source = Array.from({ length: 601 }, (_, id) => ({
      id,
      title: 'x'.repeat(80),
    }));
    const actual: number[] = [];
    let cursor: string | undefined;
    do {
      const page = paginateReadItems(
        source,
        { source: 'synthetic' },
        {
          tool: 'tree',
          resource: 'space',
          version: 'v1',
          cursor,
          limit: 50,
          maxBytes: 2048,
        },
      );
      actual.push(...page.items.map((item) => item.id));
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(2048);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(actual).toEqual(Array.from({ length: 601 }, (_, id) => id));
  });

  it('binds a cursor to the tool, resource and source version', () => {
    const cursor = encodeReadCursor('getPage', 'page1', 'v1', 10);
    expect(decodeReadCursor(cursor, 'getPage', 'page1', 'v1')).toBe(10);
    expect(() => decodeReadCursor(cursor, 'getNode', 'page1', 'v1')).toThrow(
      BadRequestException,
    );
    expect(() => decodeReadCursor(cursor, 'getPage', 'page2', 'v1')).toThrow(
      BadRequestException,
    );
    expect(() => decodeReadCursor(cursor, 'getPage', 'page1', 'v2')).toThrow(
      ConflictException,
    );
    for (const invalid of [
      '!',
      'a'.repeat(2049),
      Buffer.from('{"v":2}').toString('base64url'),
    ]) {
      expect(() => decodeReadCursor(invalid, 'getPage', 'page1', 'v1')).toThrow(
        BadRequestException,
      );
    }
  });

  it('never advances past an unreturned oversized item', () => {
    expect(() =>
      paginateReadItems(
        ['x'.repeat(40000)],
        {},
        { tool: 'test', resource: 'page', version: 'v1' },
      ),
    ).toThrow(BadRequestException);
  });
});
