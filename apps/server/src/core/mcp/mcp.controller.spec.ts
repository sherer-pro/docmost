jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { once } from 'node:events';
import { createServer, Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { McpController } from './mcp.controller';

describe('McpController protocol', () => {
  let httpServer: HttpServer;
  let client: Client;
  const execute = jest.fn(async () => ({ content: { title: 'Allowed' } }));
  const tools = {
    list: jest.fn(() => [
      {
        name: 'getPage',
        description: 'Read one page',
        inputSchema: {
          type: 'object',
          properties: { pageId: { type: 'string' } },
        },
        writeClass: 'read_only',
        exposures: ['mcp'],
        annotations: {
          destructive: false,
          idempotent: true,
          openWorld: false,
        },
      },
    ]),
    execute,
  };
  const traffic = { observeMcpTool: jest.fn() };
  const toolPolicy = {
    listForMcp: jest.fn(async () => tools.list()),
    assertMcpToolAllowed: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    const controller = new McpController(
      tools as any,
      traffic as any,
      toolPolicy as any,
    );
    httpServer = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? JSON.parse(raw) : undefined;
        await controller.handle(
          { raw: request } as any,
          { raw: response, hijack: () => undefined } as any,
          body,
          { id: 'user-1' } as any,
          { id: 'workspace-1' } as any,
          { id: 'space-1' } as any,
          { id: 'key-1' } as any,
        );
      } catch (error) {
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'text/plain' });
        }
        response.end(String(error));
      }
    });
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const port = (httpServer.address() as AddressInfo).port;
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
      ),
    );
  });

  afterAll(async () => {
    await client.close();
    httpServer.close();
    await once(httpServer, 'close');
  });

  it('lists only read-only MCP tools with safety annotations', async () => {
    const response = await client.listTools();

    expect(response.tools).toEqual([
      expect.objectContaining({
        name: 'getPage',
        annotations: expect.objectContaining({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        }),
      }),
    ]);
  });

  it('executes a tool with the authenticated space context', async () => {
    const response = await client.callTool({
      name: 'getPage',
      arguments: { pageId: 'page-1' },
    });

    expect(response.isError).not.toBe(true);
    expect(execute).toHaveBeenCalledWith(
      'getPage',
      { pageId: 'page-1' },
      expect.objectContaining({
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        source: 'mcp',
      }),
    );
    expect(traffic.observeMcpTool).toHaveBeenCalledWith(
      'success',
      expect.any(Number),
      expect.any(Number),
    );
  });
});
