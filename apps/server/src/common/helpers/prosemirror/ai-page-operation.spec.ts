import {
  applyAiPageOperation,
  assertSafeAiPageOperation,
  buildAiApprovalPreview,
  extractAiApprovalPreview,
  getAiPageOutline,
  hashProseMirrorJson,
  prepareAiPageOperation,
} from './ai-page-operation';

describe('AI page operations', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { id: 'heading-1', level: 2 },
        content: [{ type: 'text', text: 'Release notes' }],
      },
      {
        type: 'paragraph',
        attrs: { id: 'paragraph-1' },
        content: [{ type: 'text', text: 'The old summary.' }],
      },
    ],
  };

  it('applies one exact text edit without mutating the input document', () => {
    const next = applyAiPageOperation(document, {
      kind: 'editPageText',
      nodeId: 'paragraph-1',
      oldText: 'old',
      newText: 'updated',
    });

    expect(next).not.toBe(document);
    expect(next.content?.[1].content?.[0].text).toBe('The updated summary.');
    expect(document.content[1].content?.[0].text).toBe('The old summary.');
    expect(hashProseMirrorJson(next)).not.toBe(hashProseMirrorJson(document));
  });

  it('prepares stable node IDs before an approval is persisted', () => {
    const prepared = prepareAiPageOperation({
      kind: 'insertNode',
      anchorNodeId: 'paragraph-1',
      position: 'after',
      node: {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Inserted.' }],
      },
    });
    expect(prepared.kind).toBe('insertNode');
    if (prepared.kind !== 'insertNode') throw new Error('unexpected operation');
    expect(prepared.node.attrs?.id).toEqual(expect.any(String));
    expect(
      hashProseMirrorJson(applyAiPageOperation(document, prepared)),
    ).toBe(hashProseMirrorJson(applyAiPageOperation(document, prepared)));
  });

  it('rejects ambiguous text edits', () => {
    expect(() =>
      applyAiPageOperation(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'paragraph-1' },
              content: [
                { type: 'text', text: 'same' },
                { type: 'text', text: 'same' },
              ],
            },
          ],
        },
        {
          kind: 'editPageText',
          nodeId: 'paragraph-1',
          oldText: 'same',
          newText: 'different',
        },
      ),
    ).toThrow('agent_text_match_ambiguous');
  });

  it('rejects media, tables, comments, and unsafe links', () => {
    for (const type of ['image', 'table']) {
      expect(() =>
        assertSafeAiPageOperation({
          kind: 'patchNode',
          nodeId: 'paragraph-1',
          node: { type },
        }),
      ).toThrow('agent_node_type_not_allowed');
    }

    expect(() =>
      assertSafeAiPageOperation({
        kind: 'patchNode',
        nodeId: 'paragraph-1',
        node: {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'unsafe',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      }),
    ).toThrow('agent_link_not_allowed');

    expect(() =>
      assertSafeAiPageOperation({
        kind: 'patchNode',
        nodeId: 'paragraph-1',
        node: {
          type: 'paragraph',
          marks: [{ type: 'comment' }],
        },
      }),
    ).toThrow('agent_mark_type_not_allowed');
  });

  it('returns stable IDs and fallback indexes in the outline', () => {
    expect(getAiPageOutline(document)).toEqual([
      expect.objectContaining({ index: 0, id: 'heading-1', type: 'heading' }),
      expect.objectContaining({
        index: 1,
        id: 'paragraph-1',
        type: 'paragraph',
      }),
    ]);
  });

  it.each([
    {
      operation: {
        kind: 'editPageText' as const,
        nodeId: 'paragraph-1',
        oldText: 'old',
        newText: 'updated',
      },
      beforeText: 'The old summary.',
      afterText: 'The updated summary.',
    },
    {
      operation: {
        kind: 'patchNode' as const,
        nodeId: 'paragraph-1',
        node: {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Replacement.' }],
        },
      },
      beforeText: 'The old summary.',
      afterText: 'Replacement.',
    },
    {
      operation: {
        kind: 'insertNode' as const,
        anchorNodeId: 'paragraph-1',
        position: 'after' as const,
        node: {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Inserted.' }],
        },
      },
      beforeText: '',
      afterText: 'Inserted.',
    },
    {
      operation: {
        kind: 'deleteNode' as const,
        nodeId: 'paragraph-1',
      },
      beforeText: 'The old summary.',
      afterText: '',
    },
  ])(
    'builds a bounded $operation.kind approval preview',
    ({ operation, beforeText, afterText }) => {
      const preview = buildAiApprovalPreview(
        document,
        operation,
        'page-1',
        'Release',
      );

      expect(preview).toMatchObject({
        kind: operation.kind,
        pageId: 'page-1',
        pageTitle: 'Release',
        beforeText,
        afterText,
        truncated: false,
      });
    },
  );

  it('marks approval text fragments truncated at 4000 characters', () => {
    const preview = buildAiApprovalPreview(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'long' },
            content: [{ type: 'text', text: 'x'.repeat(4100) }],
          },
        ],
      },
      { kind: 'deleteNode', nodeId: 'long' },
      'page-1',
      'Long page',
    );

    expect(preview.beforeText).toHaveLength(4000);
    expect(preview.truncated).toBe(true);
  });

  it('reads only structurally valid approval previews from step results', () => {
    const preview = buildAiApprovalPreview(
      document,
      { kind: 'deleteNode', nodeId: 'paragraph-1' },
      'page-1',
      'Release',
    );
    expect(extractAiApprovalPreview({ approvalPreview: preview })).toEqual(
      preview,
    );
    expect(
      extractAiApprovalPreview({
        approvalPreview: { ...preview, beforeText: 42 },
      }),
    ).toBeNull();
  });
});
