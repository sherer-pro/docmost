import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMBED_FRAME_SOURCES,
  getEmbedFrameSources,
  isEmbedFrameSourceAllowed,
  parseEmbedAllowedOrigins,
} from './embed-frame-policy';

describe('embed frame policy', () => {
  it('parses exact HTTP origins and removes invalid values', () => {
    expect(
      parseEmbedAllowedOrigins(
        ' https://example.com/path ,javascript:alert(1), ftp://example.com, http://localhost:3000/a ',
      ),
    ).toEqual(['https://example.com', 'http://localhost:3000']);
  });

  it('merges custom origins with default sources', () => {
    const sources = getEmbedFrameSources('https://example.com/page');

    expect(sources).toContain(DEFAULT_EMBED_FRAME_SOURCES[0]);
    expect(sources).toContain('https://example.com');
  });

  it('allows exact and wildcard frame sources only', () => {
    expect(
      isEmbedFrameSourceAllowed('https://docs.google.com/document/d/id/edit'),
    ).toBe(true);
    expect(isEmbedFrameSourceAllowed('https://form.typeform.com/to/id')).toBe(
      true,
    );
    expect(isEmbedFrameSourceAllowed('https://typeform.com/home')).toBe(true);
    expect(isEmbedFrameSourceAllowed('https://example.com/embed')).toBe(false);
    expect(isEmbedFrameSourceAllowed('javascript:alert(1)')).toBe(false);
  });
});
