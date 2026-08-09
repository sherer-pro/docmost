jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import {
  AI_TOOL_RESULT_MAX_BYTES,
  AiToolResultLimitError,
  AiToolRegistryService,
  fitAiToolItems,
} from './ai-tool-registry.service';
import { AI_MCP_TOOL_NAME_PREFIX } from '../mcp/ai-mcp.constants';
import {
  AI_AGENT_MAX_TOOL_DEFINITIONS,
  AI_MCP_MAX_RUN_EXTERNAL_TOOLS,
} from '../mcp/ai-mcp.constants';
import {
  AI_BUILTIN_TOOL_CAPABILITIES,
  AI_LEGACY_AGENT_CAPABILITIES,
} from '@docmost/api-contract';

function buildRegistry(): AiToolRegistryService {
  // The constructor only assembles definitions and validates their names, so
  // the collaborators are never touched here.
  return new AiToolRegistryService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
}

describe('built-in AI tool names', () => {
  it('publishes the exact capability catalog with complete policy metadata', () => {
    const tools = buildRegistry().list('agent');

    expect(tools.map((tool) => tool.capability).sort()).toEqual(
      [...AI_BUILTIN_TOOL_CAPABILITIES].sort(),
    );
    expect(tools).toHaveLength(26);
    for (const tool of tools) {
      expect(tool).toEqual(
        expect.objectContaining({
          category: expect.any(String),
          targetScope: expect.any(String),
          approvalMode: expect.any(String),
          maxResultBytes: expect.any(Number),
          annotations: expect.objectContaining({
            idempotent: true,
            openWorld: false,
          }),
        }),
      );
      expect(tool.maxResultBytes).toBeLessThanOrEqual(AI_TOOL_RESULT_MAX_BYTES);
      expect(tool.annotations.destructive).toBe(tool.name === 'deleteNode');
    }
    expect(
      tools
        .filter((tool) =>
          AI_LEGACY_AGENT_CAPABILITIES.includes(tool.capability),
        )
        .map((tool) => tool.capability),
    ).toHaveLength(11);
  });

  it('never use the prefix reserved for external MCP tools', () => {
    const registry = buildRegistry();
    const names = [
      ...registry.list('agent').map((tool) => tool.name),
      ...registry.list('mcp').map((tool) => tool.name),
    ];

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.startsWith(AI_MCP_TOOL_NAME_PREFIX)).toBe(false);
    }
  });

  it('exposes only read-only tools to the inbound MCP surface', () => {
    const mcpTools = buildRegistry().list('mcp');

    expect(mcpTools).toHaveLength(22);
    expect(mcpTools.every((tool) => tool.writeClass === 'read_only')).toBe(
      true,
    );
    expect(new Set(mcpTools.map((tool) => tool.capability)).size).toBe(
      mcpTools.length,
    );
  });

  it('keeps the maximum built-in and external catalogs within the agent cap', () => {
    expect(
      buildRegistry().list('agent').length + AI_MCP_MAX_RUN_EXTERNAL_TOOLS,
    ).toBeLessThanOrEqual(AI_AGENT_MAX_TOOL_DEFINITIONS);
  });

  it('fails to construct when a built-in tool claims the reserved prefix', () => {
    const spy = jest
      .spyOn(AiToolRegistryService.prototype as any, 'createTools')
      .mockReturnValue([
        {
          name: `${AI_MCP_TOOL_NAME_PREFIX}ns__search_12345678`,
          description: 'shadows an external tool',
          inputSchema: { type: 'object', properties: {} },
          writeClass: 'read_only',
          exposures: ['agent'],
          execute: async () => ({ content: {} }),
        },
      ]);

    try {
      expect(() => buildRegistry()).toThrow(/reserved mcp__ prefix/);
    } finally {
      spy.mockRestore();
    }
  });

  it('reports an individual built-in result overflow as a typed limit error', async () => {
    const spy = jest
      .spyOn(AiToolRegistryService.prototype as any, 'createTools')
      .mockReturnValue([
        {
          name: 'oversizedResult',
          description: 'returns an oversized test result',
          inputSchema: { type: 'object', properties: {} },
          writeClass: 'read_only',
          exposures: ['agent'],
          capability: 'search.query',
          category: 'search',
          targetScope: 'current_space',
          approvalMode: 'none',
          maxResultBytes: 16,
          annotations: {
            idempotent: true,
            destructive: false,
            openWorld: false,
          },
          execute: async () => ({ content: { value: 'x'.repeat(64) } }),
        },
      ]);

    try {
      await expect(
        buildRegistry().execute('oversizedResult', {}, {
          source: 'agent',
        } as any),
      ).rejects.toBeInstanceOf(AiToolResultLimitError);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    {
      title: 'duplicate names',
      patch: { name: 'same' },
      expected: /Duplicate built-in AI tool name/,
    },
    {
      title: 'duplicate capabilities',
      patch: { capability: 'search.query' },
      expected: /Duplicate built-in AI tool capability/,
    },
    {
      title: 'oversized result limits',
      patch: { maxResultBytes: AI_TOOL_RESULT_MAX_BYTES + 1 },
      expected: /Invalid result limit/,
    },
    {
      title: 'write tools exposed through MCP',
      patch: {
        writeClass: 'write',
        exposures: ['mcp'],
        targetScope: 'current_page',
        approvalMode: 'current_page_hash',
      },
      expected: /Invalid policy metadata/,
    },
    {
      title: 'empty names',
      patch: { name: ' ' },
      expected: /Invalid policy metadata/,
    },
    {
      title: 'unknown categories',
      patch: { category: 'unknown' },
      expected: /Invalid policy metadata/,
    },
    {
      title: 'unknown target scopes',
      patch: { targetScope: 'global' },
      expected: /Invalid policy metadata/,
    },
    {
      title: 'unknown write classes',
      patch: { writeClass: 'direct_write' },
      expected: /Invalid policy metadata/,
    },
    {
      title: 'duplicate exposures',
      patch: { exposures: ['agent', 'agent'] },
      expected: /Invalid policy metadata/,
    },
    {
      title: 'write tools with a read approval mode',
      patch: {
        writeClass: 'write',
        exposures: ['agent'],
        targetScope: 'current_page',
        approvalMode: 'none',
      },
      expected: /Invalid policy metadata/,
    },
  ])('rejects $title', ({ patch, expected }) => {
    const base = {
      name: 'same',
      description: 'test',
      inputSchema: { type: 'object', properties: {} },
      writeClass: 'read_only',
      exposures: ['agent'],
      capability: 'search.query',
      category: 'search',
      targetScope: 'current_space',
      approvalMode: 'none',
      maxResultBytes: 1024,
      annotations: {
        idempotent: true,
        destructive: false,
        openWorld: false,
      },
      execute: async () => ({ content: {} }),
    } as any;
    const spy = jest
      .spyOn(AiToolRegistryService.prototype as any, 'createTools')
      .mockReturnValue([
        base,
        {
          ...base,
          name: 'other',
          capability: 'page.tree.read',
          ...patch,
        },
      ]);
    try {
      expect(() => buildRegistry()).toThrow(expected);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('fitAiToolItems', () => {
  it('keeps small tool results unchanged', () => {
    const items = [{ id: 'page-1', title: 'Page' }];

    expect(fitAiToolItems(items)).toEqual({ items, truncated: false });
  });

  it('truncates a large tree within the tool result byte limit', () => {
    const items = Array.from({ length: 500 }, (_, index) => ({
      id: `page-${index}`,
      parentPageId: null,
      title: `Page ${index} ${'x'.repeat(200)}`,
      slugId: `slug-${index}`,
      position: index,
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    }));

    const result = fitAiToolItems(items);

    expect(result.truncated).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(items.length);
    expect(
      Buffer.byteLength(JSON.stringify(result), 'utf8'),
    ).toBeLessThanOrEqual(AI_TOOL_RESULT_MAX_BYTES);
  });
});
