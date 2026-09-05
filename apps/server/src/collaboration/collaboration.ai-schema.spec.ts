import { Hocuspocus } from '@hocuspocus/server';
import { TiptapTransformer } from '@hocuspocus/transformer';
import * as Y from 'yjs';
import type { JSONContent } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { Paragraph } from '@tiptap/extension-paragraph';
import { TextAlign } from '@tiptap/extension-text-align';
import { Indent } from '../../../../packages/editor-ext/src/lib/indent';
import { CollaborationHandler } from './collaboration.handler';
import {
  prosemirrorNodeToYJson,
  strictJsonToNode,
  tiptapExtensions,
} from './collaboration.util';
import { AiToolRegistryService } from '../core/ai/tools/ai-tool-registry.service';
import {
  applyAiPageOperation,
  hashProseMirrorJson,
} from '../common/helpers/prosemirror/ai-page-operation';

// Use the actual paragraph attribute extensions without requiring a built
// editor-ext package in the otherwise source-only server unit suite.
const schemaExtensions = [
  StarterKit.configure({ paragraph: false }),
  Paragraph.extend({ addAttributes: () => ({ id: { default: null } }) }),
  TextAlign.configure({ types: ['paragraph'] }),
  Indent.configure({ types: ['paragraph'] }),
];
jest.mock('./collaboration.util', () => ({
  ...jest.requireActual('./collaboration.util'),
  get tiptapExtensions() {
    return schemaExtensions;
  },
  strictJsonToNode: (content: JSONContent) =>
    Node.fromJSON(getSchema(schemaExtensions), content),
}));

describe('AI writes with the production editor schema', () => {
  it('approves a minimal paragraph once and preserves the expected recovery hash', async () => {
    const hocuspocus = new Hocuspocus({
      quiet: true,
      unloadImmediately: false,
    });
    const handlers = new CollaborationHandler().getHandlers(hocuspocus);
    const pageId = '550e8400-e29b-41d4-a716-446655440000';
    const name = `page.${pageId}`;
    const connection = await hocuspocus.openDirectConnection(name, {});
    try {
      await connection.transact((doc) => {
        const seed = TiptapTransformer.toYdoc(
          {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                attrs: { id: 'anchor' },
                content: [{ type: 'text', text: 'Before' }],
              },
            ],
          },
          'default',
          tiptapExtensions,
        );
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
      });
      const live = hocuspocus.documents.get(name)!;
      const initial = TiptapTransformer.fromYdoc(live, 'default');
      const registry = Object.create(AiToolRegistryService.prototype);
      registry.pageAccess = { assertCanWritePage: jest.fn() };
      registry.getReadablePage = jest
        .fn()
        .mockResolvedValue({ id: pageId, title: 'Audit' });
      registry.getLivePageContent = jest.fn().mockResolvedValue(initial);
      const { writeProposal } = await registry.proposeWrite(
        {
          kind: 'insertNode',
          anchorNodeId: 'anchor',
          position: 'after',
          node: {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Inserted once' }],
          },
        },
        pageId,
        { source: 'agent', currentPageId: pageId, user: { id: 'user-1' } },
      );
      const expected = prosemirrorNodeToYJson(
        strictJsonToNode(
          applyAiPageOperation(initial, writeProposal.operation) as JSONContent,
        ),
      );
      expect(writeProposal.expectedAfterHash).toBe(
        hashProseMirrorJson(expected),
      );
      await expect(
        handlers.applyAiPageOperation(name, {
          ...writeProposal,
          expectedAfterHash: hashProseMirrorJson(
            applyAiPageOperation(initial, writeProposal.operation),
          ),
          user: { id: 'user-1' } as never,
        }),
      ).rejects.toThrow('agent_write_recovery_mismatch');
      expect(TiptapTransformer.fromYdoc(live, 'default')).toEqual(initial);
      await expect(
        handlers.applyAiPageOperation(name, {
          ...writeProposal,
          user: { id: 'user-1' } as never,
        }),
      ).resolves.toEqual({
        beforeHash: writeProposal.baseContentHash,
        afterHash: writeProposal.expectedAfterHash,
      });
      expect(TiptapTransformer.fromYdoc(live, 'default')).toEqual(expected);
      await expect(
        handlers.applyAiPageOperation(name, {
          ...writeProposal,
          user: { id: 'user-1' } as never,
        }),
      ).rejects.toThrow('agent_write_stale');
      expect(TiptapTransformer.fromYdoc(live, 'default')).toEqual(expected);
    } finally {
      await connection.disconnect();
    }
  });
});
