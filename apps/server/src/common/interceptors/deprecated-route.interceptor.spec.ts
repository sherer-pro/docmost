import { of } from 'rxjs';
import { DeprecatedRouteInterceptor } from './deprecated-route.interceptor';

describe('DeprecatedRouteInterceptor', () => {
  it('adds deprecation headers and logs route usage', (done) => {
    const warn = jest.fn();
    const header = jest.fn();
    const interceptor = new DeprecatedRouteInterceptor({
      sunset: 'Fri, 01 Jan 2027 00:00:00 GMT',
      replacement: 'GET /api/pages/info',
    });
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/api/files/public/file/name?jwt=secret-token&download=true',
          log: { warn },
        }),
        getResponse: () => ({ header }),
      }),
    };
    const next = { handle: () => of('ok') };

    interceptor.intercept(context as any, next as any).subscribe((value) => {
      expect(value).toBe('ok');
      expect(header).toHaveBeenCalledWith('Deprecation', 'true');
      expect(header).toHaveBeenCalledWith(
        'Sunset',
        'Fri, 01 Jan 2027 00:00:00 GMT',
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          deprecated_route: true,
          replacement: 'GET /api/pages/info',
          method: 'POST',
          path: '/api/files/public/file/name?jwt&download',
        }),
        'Deprecated API alias route was called',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token');
      done();
    });
  });
});
