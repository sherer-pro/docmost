import { BubbleMenu, BubbleMenuProps } from "@tiptap/react/menus";
import { isNodeSelection, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { FC, useEffect, useRef, useState } from "react";
import { IconMessage, IconBook2, IconRefresh } from "@tabler/icons-react";
import clsx from "clsx";
import classes from "./bubble-menu.module.css";
import { ActionIcon, Tooltip } from "@mantine/core";
import { ColorSelector } from "./color-selector";
import { NodeSelector } from "./node-selector";
import { TextAlignmentSelector } from "./text-alignment-selector";
import {
  draftCommentRangeAtom,
  draftCommentIdAtom,
  showCommentPopupAtom,
} from "@/features/comment/atoms/comment-atom";
import { useAtom } from "jotai";
import { v7 as uuid7 } from "uuid";
import {
  isCellSelection,
  isTextRangeSelected,
  isTextSelected,
} from "@docmost/editor-ext";
import { LinkSelector } from "@/features/editor/components/bubble-menu/link-selector.tsx";
import { useTranslation } from "react-i18next";
import { DictionaryTermModal } from "@/features/dictionary/components/dictionary-term-modal";
import { ToolbarActionButton } from "@/features/editor/components/bubble-menu/toolbar-action-button";
import {
  type EditorToolbarItem,
  useInlineTextToolbarItems,
} from "@/features/editor/components/bubble-menu/toolbar-items";
import { AiSelectionActionButton } from "@/features/ai/components/ai-selection-action";
import { canCreateSyncedBlock } from "./can-create-synced-block";

type EditorBubbleMenuProps = Omit<BubbleMenuProps, "children" | "editor"> & {
  editor: Editor | null;
  pageId?: string;
  spaceId?: string;
  dictionaryEnabled?: boolean;
  canManageDictionary?: boolean;
  canCreateInlineComments?: boolean;
};

export const EditorBubbleMenu: FC<EditorBubbleMenuProps> = (props) => {
  const { t } = useTranslation();
  const [showCommentPopup, setShowCommentPopup] = useAtom(showCommentPopupAtom);
  const [, setDraftCommentId] = useAtom(draftCommentIdAtom);
  const [, setDraftCommentRange] = useAtom(draftCommentRangeAtom);
  const [dictionaryModalOpened, setDictionaryModalOpened] = useState(false);
  const [dictionaryInitialTerm, setDictionaryInitialTerm] = useState("");
  const showCommentPopupRef = useRef(showCommentPopup);
  const canCreateInlineComments = props.canCreateInlineComments ?? true;
  const textItems = useInlineTextToolbarItems(props.editor);

  useEffect(() => {
    showCommentPopupRef.current = showCommentPopup;
  }, [showCommentPopup]);

  const editorState = useEditorState({
    editor: props.editor,
    selector: (ctx) => {
      if (!props.editor) {
        return null;
      }

      return {
        isComment: ctx.editor.isActive("comment"),
        isNodeSelection: isNodeSelection(ctx.editor.state.selection),
        canCreateSyncedBlock: canCreateSyncedBlock(ctx.editor),
      };
    },
  });

  const commentItem: EditorToolbarItem = {
    name: "Comment",
    isActive: Boolean(editorState?.isComment),
    command: () => {
      if (!props.editor) {
        return;
      }

      const commentId = uuid7();
      const { from, to } = props.editor.state.selection;

      props.editor.commands.setCommentDecoration();
      setDraftCommentId(commentId);
      setDraftCommentRange({ from, to });
      setShowCommentPopup(true);
    },
    icon: IconMessage,
  };
  const syncedBlockItem: EditorToolbarItem = {
    name: "Create synced block",
    command: () => {
      props.editor?.chain().focus().toggleTransclusionSource().run();
    },
    icon: IconRefresh,
  };

  const openDictionaryModal = () => {
    const selection = props.editor?.state.selection;
    if (!props.editor || !selection) {
      return;
    }

    const selectedText = props.editor.state.doc
      .textBetween(selection.from, selection.to, " ")
      .trim();

    if (!selectedText) {
      return;
    }

    setDictionaryInitialTerm(selectedText);
    setDictionaryModalOpened(true);
  };

  const bubbleMenuProps: EditorBubbleMenuProps = {
    ...props,
    shouldShow: ({ state, editor }) => {
      const { selection } = state;
      const { empty } = selection;

      if (
        !editor.isEditable ||
        empty ||
        isCellSelection(selection) ||
        showCommentPopupRef?.current
      ) {
        return false;
      }
      return isNodeSelection(selection)
        ? canCreateSyncedBlock(editor)
        : isTextSelected(editor);
    },
    options: {
      placement: "top",
      offset: 8,
      onHide: () => {
        setIsNodeSelectorOpen(false);
        setIsTextAlignmentOpen(false);
        setIsLinkSelectorOpen(false);
        setIsColorSelectorOpen(false);
      },
    },
  };

  const [isNodeSelectorOpen, setIsNodeSelectorOpen] = useState(false);
  const [isTextAlignmentSelectorOpen, setIsTextAlignmentOpen] = useState(false);
  const [isLinkSelectorOpen, setIsLinkSelectorOpen] = useState(false);
  const [isColorSelectorOpen, setIsColorSelectorOpen] = useState(false);

  return (
    <>
      <BubbleMenu
        {...bubbleMenuProps}
        style={{ zIndex: 200, position: "relative" }}
      >
        <div className={classes.bubbleMenu}>
          {editorState?.isNodeSelection ? (
            editorState.canCreateSyncedBlock && (
              <ToolbarActionButton item={syncedBlockItem} />
            )
          ) : (
            <>
              <NodeSelector
                editor={props.editor}
                isOpen={isNodeSelectorOpen}
                setIsOpen={() => {
                  setIsNodeSelectorOpen(!isNodeSelectorOpen);
                  setIsTextAlignmentOpen(false);
                  setIsLinkSelectorOpen(false);
                  setIsColorSelectorOpen(false);
                }}
              />

              <TextAlignmentSelector
                editor={props.editor}
                isOpen={isTextAlignmentSelectorOpen}
                setIsOpen={() => {
                  setIsTextAlignmentOpen(!isTextAlignmentSelectorOpen);
                  setIsNodeSelectorOpen(false);
                  setIsLinkSelectorOpen(false);
                  setIsColorSelectorOpen(false);
                }}
              />

              <ActionIcon.Group>
                {textItems.map((item) => (
                  <ToolbarActionButton
                    key={item.name}
                    item={item}
                    activeClassName={classes.active}
                  />
                ))}
                {editorState?.canCreateSyncedBlock && (
                  <ToolbarActionButton item={syncedBlockItem} />
                )}
              </ActionIcon.Group>

              <LinkSelector
                editor={props.editor}
                isOpen={isLinkSelectorOpen}
                setIsOpen={(value) => {
                  setIsLinkSelectorOpen(value);
                  setIsNodeSelectorOpen(false);
                  setIsTextAlignmentOpen(false);
                  setIsColorSelectorOpen(false);
                }}
              />

              <ColorSelector
                editor={props.editor}
                isOpen={isColorSelectorOpen}
                setIsOpen={() => {
                  setIsColorSelectorOpen(!isColorSelectorOpen);
                  setIsNodeSelectorOpen(false);
                  setIsTextAlignmentOpen(false);
                  setIsLinkSelectorOpen(false);
                }}
              />

              {props.editor && props.pageId && props.spaceId && (
                <AiSelectionActionButton
                  editor={props.editor}
                  pageId={props.pageId}
                  spaceId={props.spaceId}
                />
              )}

              {props.spaceId &&
                props.dictionaryEnabled &&
                props.canManageDictionary && (
                  <Tooltip
                    label={t("Add to dictionary")}
                    withArrow
                    withinPortal={false}
                  >
                    <ActionIcon
                      variant="default"
                      size="lg"
                      radius="6px"
                      aria-label={t("Add to dictionary")}
                      style={{ border: "none" }}
                      onClick={openDictionaryModal}
                    >
                      <IconBook2 size={16} stroke={2} />
                    </ActionIcon>
                  </Tooltip>
                )}

              {canCreateInlineComments && (
                <Tooltip
                  label={t(commentItem.name)}
                  withArrow
                  withinPortal={false}
                >
                  <ActionIcon
                    variant="default"
                    size="lg"
                    radius="6px"
                    aria-label={t(commentItem.name)}
                    className={clsx(commentItem.isActive && classes.active)}
                    style={{ border: "none" }}
                    onClick={commentItem.command}
                  >
                    <IconMessage size={16} stroke={2} />
                  </ActionIcon>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </BubbleMenu>

      {props.spaceId && (
        <DictionaryTermModal
          opened={dictionaryModalOpened}
          onClose={() => setDictionaryModalOpened(false)}
          spaceId={props.spaceId}
          initialTerm={dictionaryInitialTerm}
        />
      )}
    </>
  );
};

export const ReadOnlyCommentBubbleMenu: FC<EditorBubbleMenuProps> = (props) => {
  const { t } = useTranslation();
  const [showCommentPopup, setShowCommentPopup] = useAtom(showCommentPopupAtom);
  const [, setDraftCommentId] = useAtom(draftCommentIdAtom);
  const [, setDraftCommentRange] = useAtom(draftCommentRangeAtom);
  const showCommentPopupRef = useRef(showCommentPopup);

  useEffect(() => {
    showCommentPopupRef.current = showCommentPopup;
  }, [showCommentPopup]);

  const startComment = () => {
    if (!props.editor) {
      return;
    }

    const commentId = uuid7();
    const { from, to } = props.editor.state.selection;

    props.editor.commands.setCommentDecoration();
    setDraftCommentId(commentId);
    setDraftCommentRange({ from, to });
    setShowCommentPopup(true);
  };

  return (
    <BubbleMenu
      {...props}
      shouldShow={({ state, editor }) => {
        const { selection } = state;

        if (
          editor.isEditable ||
          editor.isActive("image") ||
          selection.empty ||
          isNodeSelection(selection) ||
          isCellSelection(selection) ||
          showCommentPopupRef.current
        ) {
          return false;
        }

        return isTextRangeSelected(editor);
      }}
      options={{
        placement: "top",
        offset: 8,
      }}
      style={{ zIndex: 200, position: "relative" }}
    >
      <div className={classes.bubbleMenu}>
        <Tooltip label={t("Comment")} withArrow withinPortal={false}>
          <ActionIcon
            variant="default"
            size="lg"
            radius="6px"
            aria-label={t("Comment")}
            style={{ border: "none" }}
            onClick={startComment}
          >
            <IconMessage size={16} stroke={2} />
          </ActionIcon>
        </Tooltip>
      </div>
    </BubbleMenu>
  );
};
