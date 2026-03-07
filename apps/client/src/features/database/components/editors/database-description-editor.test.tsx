import { describe, expect, it, vi } from 'vitest';
import classes from '@/pages/database/database-page.module.css';
import { DatabaseDescriptionEditor } from './database-description-editor';

const { mockPageEditor } = vi.hoisted(() => ({
  mockPageEditor: vi.fn(() => null),
}));

vi.mock('@/features/editor/page-editor', () => ({
  default: mockPageEditor,
}));

describe('DatabaseDescriptionEditor', () => {
  it('passes compact editor props to PageEditor wrapper', () => {
    const element = DatabaseDescriptionEditor({
      pageId: 'page-1',
      content: { type: 'doc' },
      editable: true,
      cacheSlugId: 'cache-1',
    });

    expect(element.type).toBe(mockPageEditor);
    expect(element.props.pageId).toBe('page-1');
    expect(element.props.editable).toBe(true);
    expect(element.props.cacheSlugId).toBe('cache-1');
    expect(element.props.showBottomSpacer).toBe(false);
    expect(element.props.editorContentClassName).toBe(
      classes.databaseDescriptionEditor,
    );
  });
});
