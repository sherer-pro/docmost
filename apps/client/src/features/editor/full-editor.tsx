import classes from "@/features/editor/styles/editor.module.css";
import React from "react";
import { TitleEditor } from "@/features/editor/title-editor";
import PageEditor from "@/features/editor/page-editor";
import { Container } from "@mantine/core";
import { ReactNode } from "react";
import { useAtom } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";

const MemoizedTitleEditor = React.memo(TitleEditor);
const MemoizedPageEditor = React.memo(PageEditor);

export interface FullEditorProps {
  pageId: string;
  slugId: string;
  title: string;
  content: string;
  spaceSlug: string;
  editable: boolean;
  metaPanel?: ReactNode;
  footer?: ReactNode;
  pageFullPageWidth?: boolean;
}

export function FullEditor({
  pageId,
  title,
  slugId,
  content,
  spaceSlug,
  editable,
  metaPanel,
  footer,
  pageFullPageWidth,
}: FullEditorProps) {
  const [user] = useAtom(userAtom);

  /**
   * Explicit editor width priority: page setup first,
   * then a user default, and only then a hard fallback.
   */
  const fullPageWidth =
    pageFullPageWidth ?? user.settings?.preferences?.fullPageWidth ?? false;

  return (
    <Container
      fluid={fullPageWidth}
      size={!fullPageWidth && 900}
      className={classes.editor}
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
      />
      {footer}
    </Container>
  );
}
