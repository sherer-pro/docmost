import { describe, expect, it } from 'vitest';
import {
  assertNormalizedTemplateDraft,
  createTemplateInstanceContent,
  detachTemplateContent,
  formatTemplateDraftId,
  isTemplateFieldFilled,
  normalizeTemplateDraft,
  serializeTemplateDraftSeed,
  serializeTemplateInstanceContentForHash,
  summarizeTemplateDiff,
  validateTemplateInstanceMutation,
} from './template-content';

const managed = (id: string, text: string, locked = false) => ({
  type: 'templateManagedBlock',
  attrs: { templateBlockId: id, locked },
  content: [
    {
      type: 'paragraph',
      ...(text ? { content: [{ type: 'text', text }] } : {}),
    },
  ],
});

const field = (id: string, text = '', label = 'Owner') => ({
  type: 'templateField',
  attrs: { fieldId: id, label, placeholder: 'Enter a value' },
  content: [
    {
      type: 'paragraph',
      ...(text ? { content: [{ type: 'text', text }] } : {}),
    },
  ],
});

describe('page template content', () => {
  it('ignores editor-only node ids and schema defaults in instance hashes', () => {
    const serverContent = {
      type: 'doc',
      content: [
        {
          type: 'templateManagedBlock',
          attrs: { templateBlockId: 'block-a', locked: true },
          content: [
            {
              type: 'paragraph',
              attrs: { indent: 0 },
              content: [{ type: 'text', text: 'Managed' }],
            },
          ],
        },
      ],
    };
    const editorContent: any = structuredClone(serverContent);
    editorContent.content[0].content[0].attrs = {
      indent: 0,
      id: 'local-paragraph-id',
      textAlign: null,
    };

    expect(serializeTemplateInstanceContentForHash(editorContent)).toBe(
      serializeTemplateInstanceContentForHash(serverContent),
    );
    expect(
      serializeTemplateInstanceContentForHash({
        ...serverContent,
        content: [
          {
            ...serverContent.content[0],
            attrs: { templateBlockId: 'block-b', locked: true },
          },
        ],
      }),
    ).not.toBe(serializeTemplateInstanceContentForHash(serverContent));
  });

  it('uses a key-order-independent seed and shared template ID format', () => {
    expect(
      serializeTemplateDraftSeed({ type: 'doc', content: [], attrs: {} }),
    ).toBe(serializeTemplateDraftSeed({ attrs: {}, content: [], type: 'doc' }));
    expect(
      formatTemplateDraftId(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
    ).toBe('01234567-89ab-cdef-0123-456789abcdef');
  });

  it('orders non-ASCII and case-mixed seed keys without locale collation', () => {
    expect(serializeTemplateDraftSeed({ ä: 3, a: 2, Z: 1 })).toBe(
      '{"Z":1,"a":2,"ä":3}',
    );
  });

  it('ignores editor-only null attribute defaults in normalized drafts', () => {
    const serverDraft = {
      type: 'doc',
      content: [
        {
          ...managed('block-a', 'Draft'),
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'paragraph-a', indent: 0 },
              content: [
                {
                  type: 'text',
                  marks: [
                    {
                      type: 'link',
                      attrs: { href: '/page', target: null },
                    },
                  ],
                  text: 'Draft',
                },
              ],
            },
          ],
        },
      ],
    };
    const editorDraft = structuredClone(serverDraft);
    const paragraph = editorDraft.content[0].content[0];
    paragraph.attrs = { ...paragraph.attrs, textAlign: null };

    expect(serializeTemplateDraftSeed(editorDraft)).toBe(
      serializeTemplateDraftSeed(serverDraft),
    );
    expect(normalizeTemplateDraft(editorDraft)).toEqual(
      normalizeTemplateDraft(serverDraft),
    );
  });

  it('rejects non-normalized or duplicate identities in template diffs', () => {
    expect(() =>
      assertNormalizedTemplateDraft({
        type: 'doc',
        content: [{ type: 'paragraph' }],
      }),
    ).toThrow('template_diff_requires_normalized_draft');
    expect(() =>
      assertNormalizedTemplateDraft({
        type: 'doc',
        content: [managed('duplicate', 'One'), managed('duplicate', 'Two')],
      }),
    ).toThrow('template_diff_requires_normalized_draft');
  });

  it('wraps ordinary top-level blocks as managed blocks', () => {
    const ids = ['block-a', 'block-b'];
    const normalized = normalizeTemplateDraft(
      {
        type: 'doc',
        content: [
          { type: 'paragraph' },
          { type: 'heading', attrs: { level: 2 } },
        ],
      },
      () => ids.shift()!,
    );

    expect(normalized.content).toEqual([
      {
        type: 'templateManagedBlock',
        attrs: { templateBlockId: 'block-b', locked: false },
        content: [{ type: 'heading', attrs: { level: 2 } }],
      },
    ]);
  });

  it('drops redundant empty managed blocks once the template has content', () => {
    const normalized = normalizeTemplateDraft({
      type: 'doc',
      content: [
        managed('empty-before', ''),
        field('field-a'),
        managed('empty-after', ''),
      ],
    });

    expect(normalized.content).toEqual([field('field-a')]);
  });

  it('keeps one empty managed block for a blank template', () => {
    const normalized = normalizeTemplateDraft({
      type: 'doc',
      content: [managed('empty-a', ''), managed('empty-b', '')],
    });

    expect(normalized.content).toEqual([managed('empty-a', '')]);
  });

  it('updates managed content while preserving field values', () => {
    const previous = {
      type: 'doc',
      content: [managed('block-a', 'Old', true), field('field-a', 'Alice')],
    };
    const published = {
      type: 'doc',
      content: [
        field('field-a', '', 'Project owner'),
        managed('block-a', 'New'),
      ],
    };

    const next = createTemplateInstanceContent(published, previous);

    expect(next.content?.[0].content?.[0].content?.[0].text).toBe('Alice');
    expect(next.content?.[0].attrs?.label).toBe('Project owner');
    expect(next.content?.[1].attrs?.locked).toBe(true);
    expect(next.content?.[1].content?.[0].content?.[0].text).toBe('New');
  });

  it('accepts field edits and rejects managed or structural edits', () => {
    const previous = {
      type: 'doc',
      content: [managed('block-a', 'Fixed', true), field('field-a', 'Alice')],
    };
    const fieldEdit = {
      type: 'doc',
      content: [managed('block-a', 'Fixed', true), field('field-a', 'Bob')],
    };
    const managedEdit = {
      type: 'doc',
      content: [managed('block-a', 'Changed', true), field('field-a', 'Alice')],
    };
    const reordered = {
      type: 'doc',
      content: [field('field-a', 'Alice'), managed('block-a', 'Fixed', true)],
    };

    expect(validateTemplateInstanceMutation(previous, fieldEdit)).toBe(true);
    expect(validateTemplateInstanceMutation(previous, managedEdit)).toBe(false);
    expect(validateTemplateInstanceMutation(previous, reordered)).toBe(false);
  });

  it('rejects nested template containers hidden inside editable field values', () => {
    const previous = {
      type: 'doc',
      content: [managed('block-a', 'Fixed', true), field('field-a', 'Alice')],
    };
    const nestedManagedBlock = {
      type: 'doc',
      content: [
        managed('block-a', 'Fixed', true),
        {
          ...field('field-a', ''),
          content: [managed('nested-block', 'Injected', false)],
        },
      ],
    };

    expect(validateTemplateInstanceMutation(previous, nestedManagedBlock)).toBe(
      false,
    );
  });

  it('repairs duplicate top-level service identifiers during normalization', () => {
    const generatedIds = ['block-b', 'field-b'];
    const normalized = normalizeTemplateDraft(
      {
        type: 'doc',
        content: [
          managed('shared-id', 'First'),
          managed('shared-id', 'Second'),
          field('shared-id', 'Alice'),
        ],
      },
      () => generatedIds.shift()!,
    );

    expect(normalized.content?.map((node) => node.attrs)).toEqual([
      { templateBlockId: 'shared-id', locked: false },
      { templateBlockId: 'block-b', locked: false },
      {
        fieldId: 'field-b',
        label: 'Owner',
        placeholder: 'Enter a value',
      },
    ]);
  });

  it('reports removed populated fields and structural changes', () => {
    const previous = {
      type: 'doc',
      content: [managed('block-a', 'Old'), field('field-a', '', 'Owner')],
    };
    const next = {
      type: 'doc',
      content: [managed('block-b', 'Added'), managed('block-a', 'New')],
    };

    const diff = summarizeTemplateDiff(previous, next);

    expect(diff.addedBlockIds).toEqual(['block-b']);
    expect(diff.changedBlockIds).toEqual(['block-a']);
    expect(diff.movedBlockIds).toEqual([]);
    expect(diff.removedFields).toEqual([
      { fieldId: 'field-a', label: 'Owner', placeholder: 'Enter a value' },
    ]);
  });

  it('reports only relative managed-block moves', () => {
    const previous = {
      type: 'doc',
      content: [
        managed('block-a', 'A'),
        field('field-a'),
        managed('block-b', 'B'),
        managed('block-c', 'C'),
      ],
    };
    const shiftedByInsertAndFieldMove = {
      type: 'doc',
      content: [
        managed('block-new', 'New'),
        managed('block-a', 'A'),
        managed('block-b', 'B'),
        field('field-a'),
        managed('block-c', 'C'),
      ],
    };
    const reordered = {
      type: 'doc',
      content: [
        managed('block-b', 'B'),
        managed('block-c', 'C'),
        managed('block-a', 'A'),
        field('field-a'),
      ],
    };

    expect(
      summarizeTemplateDiff(previous, shiftedByInsertAndFieldMove)
        .movedBlockIds,
    ).toEqual([]);
    expect(summarizeTemplateDiff(previous, reordered).movedBlockIds).toEqual([
      'block-a',
    ]);
  });

  it('unwraps containers when detaching and detects populated fields', () => {
    const populated = field('field-a', 'Alice');
    const detached = detachTemplateContent({
      type: 'doc',
      content: [managed('block-a', 'Fixed', true), populated],
    });

    expect(detached.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'paragraph',
    ]);
    expect(isTemplateFieldFilled(populated)).toBe(true);
    expect(isTemplateFieldFilled(field('field-b'))).toBe(false);
  });

  it('recursively unwraps nested template containers when materializing content', () => {
    const detached = detachTemplateContent({
      type: 'doc',
      content: [
        {
          ...field('field-a', ''),
          content: [managed('nested-block', 'Nested value', true)],
        },
      ],
    });

    expect(detached.content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Nested value' }],
      },
    ]);
  });
});
