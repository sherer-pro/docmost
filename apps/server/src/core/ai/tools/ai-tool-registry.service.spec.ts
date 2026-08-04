jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import {
  AI_TOOL_RESULT_MAX_BYTES,
  AiToolRegistryService,
  fitAiToolItems,
} from './ai-tool-registry.service';
import { AI_MCP_TOOL_NAME_PREFIX } from '../mcp/ai-mcp.constants';

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
  );
}

describe('built-in AI tool names', () => {
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

  it('still exposes exactly seven read-only tools to the inbound MCP surface', () => {
    const mcpTools = buildRegistry().list('mcp');

    expect(mcpTools).toHaveLength(7);
    expect(mcpTools.every((tool) => tool.writeClass === 'read_only')).toBe(true);
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
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(
      AI_TOOL_RESULT_MAX_BYTES,
    );
  });
});
