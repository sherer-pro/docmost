import { once } from 'node:events';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import type { Dispatcher } from 'undici';
import { createAiPinnedDispatcher } from './ai-pinned-http.util';

describe('createAiPinnedDispatcher', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('pinned');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });

  it('connects only through the approved address without a second DNS lookup', async () => {
    const pinned = createAiPinnedDispatcher([
      { address: '127.0.0.1', family: 4 },
    ]);

    try {
      const response = await fetch(`http://rebind.invalid:${port}/`, {
        dispatcher: pinned.dispatcher,
      } as RequestInit & { dispatcher: Dispatcher });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('pinned');
    } finally {
      await pinned.close();
    }
  });
});
