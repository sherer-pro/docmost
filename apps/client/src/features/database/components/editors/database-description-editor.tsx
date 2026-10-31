import PageEditor from "@/features/editor/page-editor";
import classes from "@/pages/database/database-page.module.css";
import type { ISpaceTagSettings } from "@/features/space/types/space.types";
import { Button } from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

export interface DatabaseDescriptionEditorProps {
  pageId: string;
  content: unknown;
  editable: boolean;
  cacheSlugId?: string;
  spaceId?: string;
  dictionaryEnabled?: boolean;
  tagSettings?: ISpaceTagSettings;
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
  tagSettings,
  canCreateInlineComments = editable,
  headingNumberingEnabled = false,
  spaceHeadingNumberingEnabled = false,
}: DatabaseDescriptionEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [descriptionRef, bounds] = useResizeObserver();
  const collapsible = bounds.height > 240;
  const isExpanded = editable || expanded;
  useEffect(() => {
    const reveal = (event: CustomEvent) => {
      const dom = event.detail?.editor?.view?.dom;
      if (dom && descriptionRef.current?.contains(dom)) setExpanded(true);
    };
    document.addEventListener("docmost:reveal-search-match", reveal);
    return () =>
      document.removeEventListener("docmost:reveal-search-match", reveal);
  }, [descriptionRef]);
  return (
    <div className={classes.databaseDescriptionEditorContainer}>
      <div
        id={id}
        className={classes.descriptionViewport}
        data-collapsed={collapsible && !isExpanded}
        onFocusCapture={() => setExpanded(true)}
      >
        <div ref={descriptionRef}>
          <PageEditor
            pageId={pageId}
            content={content}
            editable={editable}
            cacheSlugId={cacheSlugId}
            showBottomSpacer={false}
            allowTemplateApplication={false}
            editorContentClassName={classes.databaseDescriptionEditor}
            spaceId={spaceId}
            dictionaryEnabled={dictionaryEnabled}
            tagSettings={tagSettings}
            canManageDictionary={editable}
            canCreateInlineComments={canCreateInlineComments}
            headingNumberingEnabled={headingNumberingEnabled}
            spaceHeadingNumberingEnabled={spaceHeadingNumberingEnabled}
          />
        </div>
      </div>
      {!editable && collapsible && (
        <Button
          variant="subtle"
          size="compact-sm"
          mt="xs"
          aria-controls={id}
          aria-expanded={isExpanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(
            isExpanded ? "dbTable.hideDescription" : "dbTable.showDescription",
          )}
        </Button>
      )}
    </div>
  );
}
