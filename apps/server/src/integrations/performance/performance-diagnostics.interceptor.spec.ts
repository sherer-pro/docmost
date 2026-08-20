import { getPerformanceRouteTemplate } from './performance-diagnostics.interceptor';

describe('getPerformanceRouteTemplate', () => {
  it('uses the framework route template and ignores request URLs', () => {
    expect(
      getPerformanceRouteTemplate({
        routeOptions: { url: '/pages/:pageId?ignored=true' },
      }),
    ).toBe('/api/pages/:pageId');
  });

  it('does not fall back to a URL that could contain identifiers', () => {
    expect(
      getPerformanceRouteTemplate({
        method: 'GET',
      }),
    ).toBeNull();
  });
});
