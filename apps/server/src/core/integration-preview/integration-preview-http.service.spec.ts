import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { parseIntegrationPreviewUrl } from '@docmost/editor-ext/server';
import { IntegrationPreviewHttpService } from './integration-preview-http.service';

describe('integration metadata HTTP boundary', () => {
  let server: Server;
  let base: string;
  let reply: (request: any, response: any) => void;
  const policy = { resolveAllowed: jest.fn() };
  let service: IntegrationPreviewHttpService;
  beforeAll(async () => {
    server = createServer((request, response) => reply(request, response));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    policy.resolveAllowed.mockReset().mockImplementation(async (url) => ({
      url: new URL(new URL(url).pathname, base),
      addresses: [{ address: '127.0.0.1', family: 4 }],
    }));
    service = new IntegrationPreviewHttpService(
      {
        getIntegrationPreviewAllowedOrigins: () =>
          'https://api.github.com,https://gitlab.com,https://api.figma.com',
      } as any,
      policy as any,
    );
  });
  it.each([
    [
      'https://github.com/a/b/issues/1',
      'Authorization',
      'Bearer synthetic-private',
    ],
    ['https://gitlab.com/a/b/-/issues/1', 'PRIVATE-TOKEN', 'synthetic-private'],
    [
      'https://www.figma.com/design/AbCd123456/Design',
      'X-Figma-Token',
      'synthetic-private',
    ],
  ])(
    'pins one GET and sends only the selected provider credential for %s',
    async (url, header, value) => {
      reply = (request, response) => {
        expect(request.method).toBe('GET');
        for (const name of ['Authorization', 'PRIVATE-TOKEN', 'X-Figma-Token'])
          expect(request.headers[name.toLowerCase()]).toBe(
            name === header ? value : undefined,
          );
        expect(request.headers['if-none-match']).toBe('"v1"');
        response.writeHead(200, {
          'Content-Type': 'application/json',
          ETag: '"v2"',
        });
        response.end(JSON.stringify({ title: 'Synthetic metadata' }));
      };
      await expect(
        service.read(
          parseIntegrationPreviewUrl(url)!,
          'synthetic-private',
          '"v1"',
        ),
      ).resolves.toMatchObject({
        status: 200,
        etag: '"v2"',
        data: { title: 'Synthetic metadata' },
      });
      expect(policy.resolveAllowed).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          requireExplicitOrigin: true,
          denyLoopback: true,
          allowQuery: false,
          kind: 'integration-preview',
        }),
      );
    },
  );
  it('rejects forged targets before DNS or a credential-bearing request', async () => {
    const target = {
      ...parseIntegrationPreviewUrl('https://github.com/a/b')!,
      apiPath: '/user',
    };
    await expect(service.read(target, 'synthetic-private')).rejects.toThrow(
      'Invalid integration preview target',
    );
    expect(policy.resolveAllowed).not.toHaveBeenCalled();
  });
  it('does not follow redirects with a credential', async () => {
    let count = 0;
    reply = (_request, response) => {
      count++;
      response.writeHead(302, { Location: `${base}/credential-sink` });
      response.end();
    };
    await expect(
      service.read(
        parseIntegrationPreviewUrl('https://github.com/a/b')!,
        'synthetic-private',
      ),
    ).rejects.toThrow();
    expect(count).toBe(1);
  });
  it('bounds decompressed metadata rather than the compressed wire body', async () => {
    reply = (_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      });
      response.end(
        gzipSync(JSON.stringify({ title: 'x'.repeat(1024 * 1024 + 1) })),
      );
    };
    await expect(
      service.read(parseIntegrationPreviewUrl('https://github.com/a/b')!, null),
    ).rejects.toThrow('size bound');
  });
  it.each([
    ['text/html', '<script>private()</script>'],
    ['application/json', '["not an object"]'],
    ['application/json', '{broken'],
  ])('rejects malformed or non-JSON metadata %s %s', async (type, body) => {
    reply = (_request, response) => {
      response.writeHead(200, { 'Content-Type': type });
      response.end(body);
    };
    await expect(
      service.read(parseIntegrationPreviewUrl('https://github.com/a/b')!, null),
    ).rejects.toThrow();
  });
  it('fails closed when deployment policy rejects the fixed API origin', async () => {
    policy.resolveAllowed.mockRejectedValue(new Error('Origin not approved'));
    await expect(
      service.read(parseIntegrationPreviewUrl('https://github.com/a/b')!, null),
    ).rejects.toThrow('Origin not approved');
  });
});
