import { API_PREFIX_EXCLUDES } from './api-prefix-excludes';

describe('API_PREFIX_EXCLUDES', () => {
  it('keeps public share SEO routes outside the /api prefix', () => {
    expect(API_PREFIX_EXCLUDES).toContain('share/:shareId/p/:pageSlug');
    expect(API_PREFIX_EXCLUDES).toContain('share/p/:pageSlug');
    expect(API_PREFIX_EXCLUDES).toContain('mcp');
  });
});
