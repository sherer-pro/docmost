import { getSchema, Node as TiptapNode } from '@tiptap/core';
import { Paragraph } from '@tiptap/extension-paragraph';
import { StarterKit } from '@tiptap/starter-kit';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { BadRequestException } from '@nestjs/common';
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
const TestTransclusionSource = TiptapNode.create({
  name: 'transclusionSource',
  group: 'block',
  content: 'paragraph+',
});
const TestTransclusionReference = TiptapNode.create({
  name: 'transclusionReference',
  group: 'block',
  atom: true,
});
const testExtensions = [
  StarterKit.configure({ paragraph: false }),
  ParagraphWithId,
  TestTransclusionSource,
  TestTransclusionReference,
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
  it('rejects schema-invalid page content before opening the live document', async () => {
    const hocuspocus = {
      openDirectConnection: jest.fn(),
    } as unknown as Hocuspocus;
    const handler = new CollaborationHandler({} as never);
    const handlers = handler.getHandlers(hocuspocus);

    const result = handlers.updatePageContent(
      'page.550e8400-e29b-41d4-a716-446655440000',
      {
        operation: 'replace',
        prosemirrorJson: {
          type: 'doc',
          content: [
            {
              type: 'transclusionSource',
              attrs: { id: '550e8400-e29b-41d4-a716-446655440001' },
              content: [
                {
                  type: 'transclusionReference',
                  attrs: {
                    sourcePageId: '550e8400-e29b-41d4-a716-446655440000',
                    transclusionId: '550e8400-e29b-41d4-a716-446655440002',
                  },
                },
              ],
            },
          ],
        },
        user: { id: 'user-1' } as never,
      },
    );

    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toMatchObject({
      response: {
        code: 'invalid_page_content',
        message: 'Invalid page content',
      },
      status: 400,
    });
    expect(hocuspocus.openDirectConnection).not.toHaveBeenCalled();
  });

  it('restores live Yjs content when persistence rejects an update', async () => {
    const hocuspocus = {} as Hocuspocus;
    const handler = new CollaborationHandler({} as never);
    const initial = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'persisted' }],
        },
      ],
    };
    const rejected = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'rejected' }],
        },
      ],
    };
    const live = TiptapTransformer.toYdoc(
      initial,
      'default',
      testExtensions,
    );
    jest
      .spyOn(handler as any, 'replaceDocumentContent')
      .mockImplementation((...args: unknown[]) => {
        const doc = args[0] as Y.Doc;
        const content = args[1];
        const fragment = doc.getXmlFragment('default');
        if (fragment.length > 0) fragment.delete(0, fragment.length);
        const restored = TiptapTransformer.toYdoc(
          content as any,
          'default',
          testExtensions,
        );
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(restored));
      });
    const connection = jest
      .spyOn(handler as any, 'withYdocConnection')
      .mockImplementation(async (...args: unknown[]) => {
        const context = args[2] as Record<string, unknown>;
        const callback = args[3] as (doc: Y.Doc) => unknown;
        let result: unknown;
        live.transact(() => {
          result = callback(live);
        });
        if (!context.pageTemplateRecovery) {
          throw new Error('persistence_rejected');
        }
        return result;
      });

    const handlers = handler.getHandlers(hocuspocus);
    await expect(
      handlers.updatePageContent('page.test', {
        operation: 'append',
        prosemirrorJson: rejected,
        user: { id: 'user-1' } as never,
      }),
    ).rejects.toThrow('persistence_rejected');

    expect(TiptapTransformer.fromYdoc(live, 'default')).toEqual(initial);
    expect(connection).toHaveBeenCalledTimes(2);
    expect(connection.mock.calls[1][2]).toMatchObject({
      pageTemplateRecovery: true,
    });
  });

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
