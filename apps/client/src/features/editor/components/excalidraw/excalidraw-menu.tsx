import { BubbleMenu as BaseBubbleMenu } from "@tiptap/react/menus";
import { findParentNode, posToDOMRect, useEditorState } from "@tiptap/react";
import { useCallback } from "react";
import { Node as PMNode } from "prosemirror-model";
import {
  EditorMenuProps,
  ShouldShowProps,
} from "@/features/editor/components/table/types/types.ts";
import { NodeWidthResize } from "@/features/editor/components/common/node-width-resize.tsx";
import { BlockWidthModeSelector } from "@/features/editor/components/common/block-width-mode";
import {
  normalizeBlockWidthMode,
  type BlockWidthMode,
} from "@docmost/editor-ext";
import { useTranslation } from "react-i18next";

export function ExcalidrawMenu({ editor }: EditorMenuProps) {
  const { t } = useTranslation();
  const shouldShow = useCallback(
    ({ state }: ShouldShowProps) => {
      if (!state) {
        return false;
      }

      return (
        editor.isActive("excalidraw") && editor.getAttributes("excalidraw")?.src
      );
    },
    [editor],
  );

  const editorState = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) {
        return null;
      }

      const excalidrawAttr = ctx.editor.getAttributes("excalidraw");
      return {
        isExcalidraw: ctx.editor.isActive("excalidraw"),
        width: excalidrawAttr?.width ? parseInt(excalidrawAttr.width) : null,
        widthMode: normalizeBlockWidthMode(excalidrawAttr?.widthMode),
      };
    },
  });

  const getReferencedVirtualElement = useCallback(() => {
    if (!editor) return;
    const { selection } = editor.state;
    const predicate = (node: PMNode) => node.type.name === "excalidraw";
    const parent = findParentNode(predicate)(selection);

    if (parent) {
      const dom = editor.view.nodeDOM(parent?.pos) as HTMLElement;
      const domRect = dom.getBoundingClientRect();
      return {
        getBoundingClientRect: () => domRect,
        getClientRects: () => [domRect],
      };
    }

    const domRect = posToDOMRect(editor.view, selection.from, selection.to);
    return {
      getBoundingClientRect: () => domRect,
      getClientRects: () => [domRect],
    };
  }, [editor]);

  const onWidthChange = useCallback(
    (value: number) => {
      editor.commands.updateAttributes("excalidraw", { width: `${value}%` });
    },
    [editor],
  );

  const onWidthModeChange = useCallback(
    (widthMode: BlockWidthMode) => {
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .updateAttributes("excalidraw", { widthMode })
        .run();
    },
    [editor],
  );

  return (
    <BaseBubbleMenu
      editor={editor}
      pluginKey={`excalidraw-menu`}
      updateDelay={0}
      getReferencedVirtualElement={getReferencedVirtualElement}
      options={{
        placement: "top",
        offset: 8,
        flip: false,
      }}
      shouldShow={shouldShow}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {editorState && (
          <BlockWidthModeSelector
            value={editorState.widthMode}
            onChange={onWidthModeChange}
            label={t("Diagram width")}
          />
        )}
        {editorState?.width && (
          <NodeWidthResize onChange={onWidthChange} value={editorState.width} />
        )}
      </div>
    </BaseBubbleMenu>
  );
}

export default ExcalidrawMenu;
