import { describe, expect, it } from 'vitest';
import {
  createTemplateInstanceContent,
  detachTemplateContent,
  isTemplateFieldFilled,
  normalizeTemplateDraft,
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
  it('wraps ordinary top-level blocks as managed blocks', () => {
    const ids = ['block-a', 'block-b'];
    const normalized = normalizeTemplateDraft(
      {
        type: 'doc',
        content: [{ type: 'paragraph' }, { type: 'heading', attrs: { level: 2 } }],
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
      content: [field('field-a', '', 'Project owner'), managed('block-a', 'New')],
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
    expect(diff.movedBlockIds).toContain('block-a');
    expect(diff.removedFields).toEqual([
      { fieldId: 'field-a', label: 'Owner', placeholder: 'Enter a value' },
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
});
