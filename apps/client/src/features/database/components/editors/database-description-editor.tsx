import PageEditor from '@/features/editor/page-editor';
import classes from '@/pages/database/database-page.module.css';

export interface DatabaseDescriptionEditorProps {
  pageId: string;
  content: unknown;
  editable: boolean;
  cacheSlugId?: string;
  spaceId?: string;
  dictionaryEnabled?: boolean;
  canCreateInlineComments?: boolean;
  headingNumberingEnabled?: boolean;
  spaceHeadingNumberingEnabled?: boolean;
}

/**
 * Thin wrapper over the main page editor.
 *
 * Database description reuses the same editor engine and collaboration flow
 * as regular pages, while preserving compact database-page styling.
 */
export function DatabaseDescriptionEditor({
  pageId,
  content,
  editable,
  cacheSlugId,
  spaceId,
  dictionaryEnabled = false,
  canCreateInlineComments = editable,
  headingNumberingEnabled = false,
  spaceHeadingNumberingEnabled = false,
}: DatabaseDescriptionEditorProps) {
  return (
    <div className={classes.databaseDescriptionEditorContainer}>
      <PageEditor
        pageId={pageId}
        content={content}
        editable={editable}
        cacheSlugId={cacheSlugId}
        showBottomSpacer={false}
        editorContentClassName={classes.databaseDescriptionEditor}
        spaceId={spaceId}
        dictionaryEnabled={dictionaryEnabled}
        canManageDictionary={editable}
        canCreateInlineComments={canCreateInlineComments}
        headingNumberingEnabled={headingNumberingEnabled}
        spaceHeadingNumberingEnabled={spaceHeadingNumberingEnabled}
      />
    </div>
  );
}
