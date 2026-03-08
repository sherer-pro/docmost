import { describe, expect, it } from 'vitest';
import { getEmbedUrlAndProvider } from '@docmost/editor-ext';

describe('embed provider compatibility', () => {
  it('uses iframe provider for arbitrary http/https URLs', () => {
    const url = 'https://example.org/widgets/board?id=42';

    const result = getEmbedUrlAndProvider(url);

    expect(result).toEqual({
      embedUrl: url,
      provider: 'iframe',
    });
  });
});
