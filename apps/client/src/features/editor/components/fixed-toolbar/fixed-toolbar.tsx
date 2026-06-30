import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { ActionIcon, Button, Tooltip } from "@mantine/core";
import {
  IconBook2,
  IconCheckbox,
  IconIndentDecrease,
  IconIndentIncrease,
  IconList,
  IconListNumbers,
  IconMessage,
  IconPageBreak,
  IconSparkles,
} from "@tabler/icons-react";
import { isTextRangeSelected } from "@docmost/editor-ext";
import clsx from "clsx";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { v7 as uuid7 } from "uuid";

import {
  draftCommentIdAtom,
  draftCommentRangeAtom,
  showCommentPopupAtom,
} from "@/features/comment/atoms/comment-atom";
import { DictionaryTermModal } from "@/features/dictionary/components/dictionary-term-modal";
import { ColorSelector } from "@/features/editor/components/bubble-menu/color-selector";
import { LinkSelector } from "@/features/editor/components/bubble-menu/link-selector";
import { NodeSelector } from "@/features/editor/components/bubble-menu/node-selector";
import { TextAlignmentSelector } from "@/features/editor/components/bubble-menu/text-alignment-selector";
import { ToolbarActionButton } from "@/features/editor/components/bubble-menu/toolbar-action-button";
import {
  type EditorToolbarItem,
  useInlineTextToolbarItems,
} from "@/features/editor/components/bubble-menu/toolbar-items";
import { showAiMenuAtom } from "@/features/editor/atoms/editor-atoms";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import classes from "./fixed-toolbar.module.css";

interface FixedToolbarProps {
  editor: Editor;
  spaceId?: string;
  dictionaryEnabled?: boolean;
  canManageDictionary?: boolean;
  canCreateInlineComments?: boolean;
}

export function FixedToolbar({
  editor,
  spaceId,
  dictionaryEnabled = false,
  canManageDictionary = false,
  canCreateInlineComments = true,
}: FixedToolbarProps) {
  const { t } = useTranslation();
  const [, setShowAiMenu] = useAtom(showAiMenuAtom);
  const [, setShowCommentPopup] = useAtom(showCommentPopupAtom);
  const [, setDraftCommentId] = useAtom(draftCommentIdAtom);
  const [, setDraftCommentRange] = useAtom(draftCommentRangeAtom);
  const workspace = useAtomValue(workspaceAtom);
  const isGenerativeAiEnabled = workspace?.settings?.ai?.generative === true;
  const [isNodeSelectorOpen, setIsNodeSelectorOpen] = useState(false);
  const [isTextAlignmentSelectorOpen, setIsTextAlignmentOpen] = useState(false);
  const [isLinkSelectorOpen, setIsLinkSelectorOpen] = useState(false);
  const [isColorSelectorOpen, setIsColorSelectorOpen] = useState(false);
  const [dictionaryModalOpened, setDictionaryModalOpened] = useState(false);
  const [dictionaryInitialTerm, setDictionaryInitialTerm] = useState("");
  const textItems = useInlineTextToolbarItems(editor);

  const editorState = useEditorState({
    editor,
    selector: (ctx) => {
      const { selection } = ctx.editor.state;
      const selectedText = ctx.editor.state.doc
        .textBetween(selection.from, selection.to, " ")
        .trim();

      return {
        isBulletList: ctx.editor.isActive("bulletList"),
        isOrderedList: ctx.editor.isActive("orderedList"),
        isTaskItem: ctx.editor.isActive("taskItem"),
        isComment: ctx.editor.isActive("comment"),
        hasTextSelection: isTextRangeSelected(ctx.editor),
        selectedText,
        canOutdent: ctx.editor.can().chain().outdent().run(),
        canIndent: ctx.editor.can().chain().indent().run(),
      };
    },
  });

  const closeSelectorPopovers = () => {
    setIsNodeSelectorOpen(false);
    setIsTextAlignmentOpen(false);
    setIsLinkSelectorOpen(false);
    setIsColorSelectorOpen(false);
  };

  const blockItems: EditorToolbarItem[] = [
    {
      name: "Bullet List",
      isActive: Boolean(editorState?.isBulletList),
      command: () => editor.chain().focus().toggleBulletList().run(),
      icon: IconList,
    },
    {
      name: "Numbered List",
      isActive: Boolean(editorState?.isOrderedList),
      command: () => editor.chain().focus().toggleOrderedList().run(),
      icon: IconListNumbers,
    },
    {
      name: "To-do List",
      isActive: Boolean(editorState?.isTaskItem),
      command: () => editor.chain().focus().toggleTaskList().run(),
      icon: IconCheckbox,
    },
    {
      name: "Outdent",
      disabled: !editorState?.canOutdent,
      command: () => editor.chain().focus().outdent().run(),
      icon: IconIndentDecrease,
    },
    {
      name: "Indent",
      disabled: !editorState?.canIndent,
      command: () => editor.chain().focus().indent().run(),
      icon: IconIndentIncrease,
    },
    {
      name: "Page break",
      command: () => editor.chain().focus().setPageBreak().run(),
      icon: IconPageBreak,
    },
  ];

  const openDictionaryModal = () => {
    const selectedText = editorState?.selectedText ?? "";

    if (!spaceId || !selectedText) {
      return;
    }

    closeSelectorPopovers();
    setDictionaryInitialTerm(selectedText);
    setDictionaryModalOpened(true);
  };

  const startComment = () => {
    if (!canCreateInlineComments || !editorState?.hasTextSelection) {
      return;
    }

    closeSelectorPopovers();

    const commentId = uuid7();
    const { from, to } = editor.state.selection;

    editor.commands.setCommentDecoration();
    setDraftCommentId(commentId);
    setDraftCommentRange({ from, to });
    setShowCommentPopup(true);
  };

  const showDictionaryAction = Boolean(
    spaceId && dictionaryEnabled && canManageDictionary,
  );

  return (
    <>
      <div
        className={classes.fixedToolbar}
        role="toolbar"
        aria-label={t("Editor toolbar")}
      >
        <div className={classes.toolbarInner}>
          {isGenerativeAiEnabled && (
            <>
              <Button
                variant="default"
                className={classes.aiButton}
                radius="0"
                leftSection={<IconSparkles size={16} />}
                onClick={() => {
                  closeSelectorPopovers();
                  setShowAiMenu(true);
                }}
              >
                {t("Ask AI")}
              </Button>
              <div className={classes.divider} />
            </>
          )}

          <NodeSelector
            editor={editor}
            isOpen={isNodeSelectorOpen}
            tooltipWithinPortal
            setIsOpen={() => {
              setIsNodeSelectorOpen(!isNodeSelectorOpen);
              setIsTextAlignmentOpen(false);
              setIsLinkSelectorOpen(false);
              setIsColorSelectorOpen(false);
            }}
          />

          <TextAlignmentSelector
            editor={editor}
            isOpen={isTextAlignmentSelectorOpen}
            tooltipWithinPortal
            setIsOpen={() => {
              setIsTextAlignmentOpen(!isTextAlignmentSelectorOpen);
              setIsNodeSelectorOpen(false);
              setIsLinkSelectorOpen(false);
              setIsColorSelectorOpen(false);
            }}
          />

          <div className={classes.divider} />

          <ActionIcon.Group>
            {textItems.map((item) => (
              <ToolbarActionButton
                key={item.name}
                item={item}
                activeClassName={classes.active}
                onBeforeRun={closeSelectorPopovers}
              />
            ))}
          </ActionIcon.Group>

          <LinkSelector
            editor={editor}
            isOpen={isLinkSelectorOpen}
            setIsOpen={(value) => {
              setIsLinkSelectorOpen(value);
              setIsNodeSelectorOpen(false);
              setIsTextAlignmentOpen(false);
              setIsColorSelectorOpen(false);
            }}
          />

          <ColorSelector
            editor={editor}
            isOpen={isColorSelectorOpen}
            setIsOpen={() => {
              setIsColorSelectorOpen(!isColorSelectorOpen);
              setIsNodeSelectorOpen(false);
              setIsTextAlignmentOpen(false);
              setIsLinkSelectorOpen(false);
            }}
          />

          {showDictionaryAction && (
            <Tooltip label={t("Add to dictionary")} withArrow>
              <ActionIcon
                variant="default"
                size="lg"
                radius="0"
                aria-label={t("Add to dictionary")}
                disabled={!editorState?.selectedText}
                style={{ border: "none" }}
                onClick={openDictionaryModal}
              >
                <IconBook2 size={16} stroke={2} />
              </ActionIcon>
            </Tooltip>
          )}

          {canCreateInlineComments && (
            <Tooltip label={t("Comment")} withArrow>
              <ActionIcon
                variant="default"
                size="lg"
                radius="0"
                aria-label={t("Comment")}
                disabled={!editorState?.hasTextSelection}
                className={clsx(editorState?.isComment && classes.active)}
                style={{ border: "none" }}
                onClick={startComment}
              >
                <IconMessage size={16} stroke={2} />
              </ActionIcon>
            </Tooltip>
          )}

          <div className={classes.divider} />

          <ActionIcon.Group>
            {blockItems.map((item) => (
              <ToolbarActionButton
                key={item.name}
                item={item}
                activeClassName={classes.active}
                onBeforeRun={closeSelectorPopovers}
              />
            ))}
          </ActionIcon.Group>
        </div>
      </div>

      {spaceId && (
        <DictionaryTermModal
          opened={dictionaryModalOpened}
          onClose={() => setDictionaryModalOpened(false)}
          spaceId={spaceId}
          initialTerm={dictionaryInitialTerm}
        />
      )}
    </>
  );
}
