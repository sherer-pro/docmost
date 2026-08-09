import {
  getClientStaticCacheControl,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  injectWindowConfigScript,
  isApiRequestPath,
  SERVICE_WORKER_CACHE_CONTROL,
  WINDOW_CONFIG_SCRIPT_TAG,
} from './static.module';

describe('injectWindowConfigScript', () => {
  it('replaces the placeholder with the runtime config script tag', () => {
    const html = '<body><div id="root"></div><!--window-config--></body>';

    expect(injectWindowConfigScript(html)).toBe(
      `<body><div id="root"></div>${WINDOW_CONFIG_SCRIPT_TAG}</body>`,
    );
  });

  it('does not duplicate an existing runtime config script tag', () => {
    const html = `<body>${WINDOW_CONFIG_SCRIPT_TAG}</body>`;

    expect(injectWindowConfigScript(html)).toBe(html);
  });

  it('injects the runtime config script before body close when no placeholder exists', () => {
    const html = '<body><div id="root"></div></body>';

    expect(injectWindowConfigScript(html)).toBe(
      `<body><div id="root"></div>${WINDOW_CONFIG_SCRIPT_TAG}\n  </body>`,
    );
  });
});

describe('getClientStaticCacheControl', () => {
  it('prevents stale service worker and manifest responses', () => {
    expect(getClientStaticCacheControl('/app/apps/client/dist/sw.js')).toBe(
      SERVICE_WORKER_CACHE_CONTROL,
    );
    expect(
      getClientStaticCacheControl('/app/apps/client/dist/manifest.json'),
    ).toBe(SERVICE_WORKER_CACHE_CONTROL);
  });

  it('allows long-lived caching for hashed build assets', () => {
    expect(
      getClientStaticCacheControl(
        '/app/apps/client/dist/assets/page-abc123.js',
      ),
    ).toBe(IMMUTABLE_ASSET_CACHE_CONTROL);
  });

  it('leaves other static files on the default cache policy', () => {
    expect(
      getClientStaticCacheControl(
        '/app/apps/client/dist/icons/favicon-32x32.png',
      ),
    ).toBeNull();
  });
});

describe('isApiRequestPath', () => {
  it.each(['/api', '/api/', '/api/unknown', '/api/unknown?source=browser'])(
    'recognizes the API namespace for %s',
    (requestUrl) => {
      expect(isApiRequestPath(requestUrl)).toBe(true);
    },
  );

  it.each(['/', '/home', '/settings/security', '/api-client'])(
    'keeps frontend routes in the SPA fallback for %s',
    (requestUrl) => {
      expect(isApiRequestPath(requestUrl)).toBe(false);
    },
  );
});
