import "@/features/editor/styles/index.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { Text } from "@tiptap/extension-text";
import { Placeholder } from "@tiptap/extension-placeholder";
import { useAtomValue } from "jotai";
import {
  pageEditorAtom,
  titleEditorAtom,
} from "@/features/editor/atoms/editor-atoms";
import {
  updatePageData,
  useUpdateTitlePageMutation,
} from "@/features/page/queries/page-query";
import { useDebouncedCallback, getHotkeyHandler } from "@mantine/hooks";
import { useAtom } from "jotai";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { History } from "@tiptap/extension-history";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import EmojiCommand from "@/features/editor/extensions/emoji-command.ts";
import { UpdateEvent } from "@/features/websocket/types";
import localEmitter from "@/lib/local-emitter.ts";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { searchSpotlight } from "@/features/search/constants.ts";
import { shouldApplyFocusSafeTitleSync } from "@/features/editor/utils/title-editor-sync.ts";
import { useDeferredCanonicalTitleUrlSync } from "@/features/editor/utils/canonical-title-url-sync.ts";

export interface TitleEditorProps {
  pageId: string;
  slugId: string;
  title: string;
  spaceSlug: string;
  editable: boolean;
}

export function TitleEditor({
  pageId,
  slugId,
  title,
  spaceSlug,
  editable,
}: TitleEditorProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateTitlePageMutationAsync } =
    useUpdateTitlePageMutation();
  const pageEditor = useAtomValue(pageEditorAtom);
  const [, setTitleEditor] = useAtom(titleEditorAtom);
  const emit = useQueryEmit();
  const navigate = useNavigate();
  const location = useLocation();
  const [activePageId, setActivePageId] = useState(pageId);
  const didInitFocusRef = useRef(false);
  const lastSyncedPageIdRef = useRef(pageId);
  const [currentUser] = useAtom(currentUserAtom);
  const userPageEditMode =
    currentUser?.user?.settings?.preferences?.pageEditMode ?? PageEditMode.Edit;

  const { onTitleFocusChange, syncCanonicalUrl } =
    useDeferredCanonicalTitleUrlSync(
      useCallback(
        (nextUrl: string) => {
          navigate(nextUrl, { replace: true });
        },
        [navigate],
      ),
    );

  const titleEditor = useEditor({
    extensions: [
      Document.extend({
        content: "heading",
      }),
      Heading.configure({
        levels: [1],
      }),
      Text,
      Placeholder.configure({
        placeholder: t("Untitled"),
        showOnlyWhenEditable: false,
      }),
      History.configure({
        depth: 20,
      }),
      EmojiCommand,
    ],
    onCreate({ editor }) {
      if (editor) {
        // @ts-ignore
        setTitleEditor(editor);
        setActivePageId(pageId);
      }
    },
    onUpdate({ editor }) {
      debounceUpdate();
    },
    editable: editable,
    content: title,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      handleDOMEvents: {
        focus: () => {
          onTitleFocusChange(true);
          return false;
        },
        blur: () => {
          onTitleFocusChange(false);
          return false;
        },
        keydown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") {
            event.preventDefault();
            return true;
          }
          if ((event.ctrlKey || event.metaKey) && event.code === "KeyK") {
            searchSpotlight.open();
            return true;
          }
        },
      },
    },
  });

  useEffect(() => {
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    const canonicalPath = buildPageUrl(spaceSlug, slugId, title);

    syncCanonicalUrl({
      currentUrl,
      nextUrl: `${canonicalPath}${location.search}${location.hash}`,
    });
  }, [
    location.hash,
    location.pathname,
    location.search,
    slugId,
    spaceSlug,
    syncCanonicalUrl,
    title,
  ]);

  const saveTitle = useCallback(() => {
    if (!titleEditor || activePageId !== pageId) return;

    if (
      titleEditor.getText() === title ||
      (titleEditor.getText() === "" && title === null)
    ) {
      return;
    }

    updateTitlePageMutationAsync({
      pageId: pageId,
      title: titleEditor.getText(),
    }).then((page) => {
      const event: UpdateEvent = {
        operation: "updateOne",
        spaceId: page.spaceId,
        entity: ["pages"],
        id: page.id,
        payload: {
          title: page.title,
          slugId: page.slugId,
          parentPageId: page.parentPageId,
          icon: page.icon,
        },
      };

      if (page.title !== titleEditor.getText()) return;

      updatePageData(page);

      localEmitter.emit("message", event);
      emit(event);
    });
  }, [pageId, title, titleEditor]);

  const debounceUpdate = useDebouncedCallback(saveTitle, 500);

  useEffect(() => {
    if (!titleEditor) {
      return;
    }

    const nextTitle = title ?? "";
    const currentTitle = titleEditor.getText();
    const { from, to } = titleEditor.state.selection;

    const shouldApplySync = shouldApplyFocusSafeTitleSync({
      entityId: pageId,
      lastSyncedEntityId: lastSyncedPageIdRef.current,
      nextTitle,
      currentTitle,
      isFocused: titleEditor.isFocused,
      hasCollapsedSelection: from === to,
    });

    if (!shouldApplySync) {
      if (nextTitle === currentTitle) {
        lastSyncedPageIdRef.current = pageId;
      }
      return;
    }

    titleEditor.commands.setContent(nextTitle);
    lastSyncedPageIdRef.current = pageId;
  }, [pageId, title, titleEditor]);

  useEffect(() => {
    if (!titleEditor || didInitFocusRef.current) {
      return;
    }

    didInitFocusRef.current = true;

    const focusTimer = setTimeout(() => {
      // guard against Cannot access view['hasFocus'] error
      if (!titleEditor.isInitialized) return;
      titleEditor.commands.focus("end");
    }, 300);

    return () => {
      clearTimeout(focusTimer);
    };
  }, [titleEditor]);

  useEffect(() => {
    return () => {
      // force-save title on navigation
      saveTitle();
    };
  }, [pageId]);

  useEffect(() => {
    // honor user default page edit mode preference
    if (userPageEditMode && titleEditor && editable) {
      if (userPageEditMode === PageEditMode.Edit) {
        titleEditor.setEditable(true);
      } else if (userPageEditMode === PageEditMode.Read) {
        titleEditor.setEditable(false);
      }
    }
  }, [userPageEditMode, titleEditor, editable]);

  const openSearchDialog = () => {
    const event = new CustomEvent("openFindDialogFromEditor", {});
    document.dispatchEvent(event);
  };

  function handleTitleKeyDown(event: any) {
    if (!titleEditor || !pageEditor || event.shiftKey) return;

    // Prevent focus shift when IME composition is active
    // `keyCode === 229` is added to support Safari where `isComposing` may not be reliable
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;

    const { key } = event;
    const { $head } = titleEditor.state.selection;

    if (key === "Enter") {
      event.preventDefault();

      const { $from } = titleEditor.state.selection;
      const titleText = titleEditor.getText();

      // Get the text offset within the heading node (not document position)
      const textOffset = $from.parentOffset;

      const textAfterCursor = titleText.slice(textOffset);

      // Delete text after cursor from title (this will be in undo history)
      const endPos = titleEditor.state.doc.content.size;
      if (textAfterCursor) {
        titleEditor.commands.deleteRange({ from: $from.pos, to: endPos });
      }

      // Don't add to history so undo in page editor won't remove this split
      pageEditor
        .chain()
        .command(({ tr }) => {
          tr.setMeta("addToHistory", false);
          return true;
        })
        .insertContentAt(0, {
          type: "paragraph",
          content: textAfterCursor
            ? [{ type: "text", text: textAfterCursor }]
            : undefined,
        })
        .focus("start")
        .run();
      return;
    }

    const shouldFocusEditor =
      key === "ArrowDown" || (key === "ArrowRight" && !$head.nodeAfter);

    if (shouldFocusEditor) {
      pageEditor.commands.focus("start");
    }
  }

  return (
    <EditorContent
      editor={titleEditor}
      onKeyDown={(event) => {
        // First handle the search hotkey
        getHotkeyHandler([["mod+F", openSearchDialog]])(event);

        // Then handle other key events
        handleTitleKeyDown(event);
      }}
    />
  );
}
