import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import classes from '@/pages/database/database-page.module.css';
import { DatabaseDescriptionEditor } from './database-description-editor';

const { mockPageEditor } = vi.hoisted(() => ({
  mockPageEditor: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/editor/page-editor', () => ({
  default: mockPageEditor,
}));

describe('DatabaseDescriptionEditor', () => {
  it('passes compact editor props to PageEditor wrapper', () => {
    const html = renderToStaticMarkup(
      <DatabaseDescriptionEditor
        pageId="page-1"
        content={{ type: 'doc' }}
        editable
        cacheSlugId="cache-1"
      />,
    );
    expect(html).toContain(classes.databaseDescriptionEditorContainer);

    const props = mockPageEditor.mock.calls[0][0];
    expect(props.pageId).toBe('page-1');
    expect(props.editable).toBe(true);
    expect(props.cacheSlugId).toBe('cache-1');
    expect(props.showBottomSpacer).toBe(false);
    expect(props.allowTemplateApplication).toBe(false);
    expect(props.editorContentClassName).toBe(
      classes.databaseDescriptionEditor,
    );
  });
});
