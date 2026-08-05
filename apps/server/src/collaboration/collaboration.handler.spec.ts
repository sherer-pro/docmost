import { getSchema } from '@tiptap/core';
import { Paragraph } from '@tiptap/extension-paragraph';
import { StarterKit } from '@tiptap/starter-kit';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Hocuspocus } from '@hocuspocus/server';
import { TiptapTransformer } from '@hocuspocus/transformer';
import * as Y from 'yjs';
import { CollaborationHandler } from './collaboration.handler';
import {
  applyAiPageOperation,
  hashProseMirrorJson,
} from '../common/helpers/prosemirror/ai-page-operation';

const ParagraphWithId = Paragraph.extend({
  addAttributes() {
    return { id: { default: null } };
  },
});
const testExtensions = [
  StarterKit.configure({ paragraph: false }),
  ParagraphWithId,
];
const testSchema = getSchema(testExtensions);

jest.mock('./collaboration.util', () => {
  const actual = jest.requireActual('./collaboration.util');
  return {
    ...actual,
    strictJsonToNode: (content: unknown) =>
      ProseMirrorNode.fromJSON(testSchema, content),
  };
});

describe('CollaborationHandler approved AI writes', () => {
  it('preserves unchanged Yjs node identity and RelativePosition', async () => {
    const hocuspocus = new Hocuspocus({
      quiet: true,
      unloadImmediately: false,
    });
    const handler = new CollaborationHandler({} as never);
    const handlers = handler.getHandlers(hocuspocus);
    const documentName = 'page.550e8400-e29b-41d4-a716-446655440000';
    const initial = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'p1' },
          content: [{ type: 'text', text: 'unchanged' }],
        },
        {
          type: 'paragraph',
          attrs: { id: 'p2' },
          content: [{ type: 'text', text: 'before' }],
        },
      ],
    };
    const operation = {
      kind: 'patchNode' as const,
      nodeId: 'p2',
      node: {
        type: 'paragraph',
        content: [{ type: 'text', text: 'after' }],
      },
    };
    const expected = applyAiPageOperation(initial, operation);
    const primary = await hocuspocus.openDirectConnection(documentName, {});
    await primary.transact((document) => {
      const seeded = TiptapTransformer.toYdoc(
        initial,
        'default',
        testExtensions,
      );
      Y.applyUpdate(document, Y.encodeStateAsUpdate(seeded));
    });
    const live = hocuspocus.documents.get(documentName)!;
    const fragment = live.getXmlFragment('default');
    const unchangedNode = fragment.get(0) as Y.AbstractType<unknown>;
    const relativePosition = Y.createRelativePositionFromTypeIndex(
      unchangedNode,
      0,
    );

    await handlers.applyAiPageOperation(documentName, {
      operation,
      baseContentHash: hashProseMirrorJson(initial),
      expectedAfterHash: hashProseMirrorJson(expected),
      user: { id: 'user-1' } as never,
    });

    expect(fragment.get(0)).toBe(unchangedNode);
    expect(
      Y.createAbsolutePositionFromRelativePosition(relativePosition, live),
    ).not.toBeNull();
    expect(TiptapTransformer.fromYdoc(live, 'default')).toEqual(expected);

    await primary.disconnect();
  });
});
