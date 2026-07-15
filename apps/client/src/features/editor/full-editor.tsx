import classes from "@/features/editor/styles/editor.module.css";
import clsx from "clsx";
import React from "react";
import { TitleEditor } from "@/features/editor/title-editor";
import PageEditor from "@/features/editor/page-editor";
import { Container } from "@mantine/core";
import { ReactNode } from "react";
import { useAtom } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { resolvePageEditMode } from "@/features/user/utils/page-edit-mode.ts";
import { resolvePageFullWidth } from "@/features/user/utils/page-width.ts";

const MemoizedTitleEditor = React.memo(TitleEditor);
const MemoizedPageEditor = React.memo(PageEditor);

export interface FullEditorProps {
  pageId: string;
  slugId: string;
  title: string;
  content: string;
  spaceSlug: string;
  spaceId?: string;
  dictionaryEnabled?: boolean;
  headingNumberingEnabled?: boolean;
  editable: boolean;
  metaPanel?: ReactNode;
  footer?: ReactNode;
}

export function FullEditor({
  pageId,
  title,
  slugId,
  content,
  spaceSlug,
  spaceId,
  dictionaryEnabled = false,
  headingNumberingEnabled = false,
  editable,
  metaPanel,
  footer,
}: FullEditorProps) {
  const [user] = useAtom(userAtom);

  /**
   * Explicit editor width priority:
   * 1) user page-level override;
   * 2) user global default;
   * 3) safe fallback `false`.
   */
  const fullPageWidth = resolvePageFullWidth({
    pageId,
    preferences: user?.settings?.preferences,
  });
  const userPageEditMode = resolvePageEditMode({
    pageId,
    preferences: user?.settings?.preferences,
  });
  const fixedToolbarEnabled = Boolean(
    editable &&
      userPageEditMode === PageEditMode.Edit &&
      user?.settings?.preferences?.fixedToolbar,
  );

  return (
    <Container
      fluid={fullPageWidth}
      size={!fullPageWidth && 900}
      className={clsx(
        classes.editor,
        fixedToolbarEnabled && classes.editorWithFixedToolbar,
      )}
      data-page-full-width={fullPageWidth ? "true" : "false"}
    >
      <MemoizedTitleEditor
        pageId={pageId}
        slugId={slugId}
        title={title}
        spaceSlug={spaceSlug}
        editable={editable}
      />
      {metaPanel}
      <MemoizedPageEditor
        pageId={pageId}
        editable={editable}
        content={content}
        showBottomSpacer={!footer}
        spaceId={spaceId}
        dictionaryEnabled={dictionaryEnabled}
        headingNumberingEnabled={headingNumberingEnabled}
        canManageDictionary={editable}
        canCreateInlineComments={editable}
      />
      {footer}
    </Container>
  );
}
