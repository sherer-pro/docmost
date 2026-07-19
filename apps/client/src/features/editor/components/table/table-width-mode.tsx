import { FC, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { findParentNode, useEditorState } from "@tiptap/react";
import {
  normalizeTableWidthMode,
  type TableWidthMode,
} from "@docmost/editor-ext";
import { useTranslation } from "react-i18next";
import { BlockWidthModeSelector } from "@/features/editor/components/common/block-width-mode";

interface TableWidthModeSelectorProps {
  editor: Editor;
}

export const TableWidthModeSelector: FC<TableWidthModeSelectorProps> = ({
  editor,
}) => {
  const { t } = useTranslation();
  const widthMode = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) {
        return "normal";
      }

      const table = findParentNode((node) => node.type.name === "table")(
        ctx.editor.state.selection,
      );

      return normalizeTableWidthMode(table?.node.attrs.widthMode);
    },
  });

  const setWidthMode = useCallback(
    (nextMode: TableWidthMode) => {
      const table = findParentNode((node) => node.type.name === "table")(
        editor.state.selection,
      );

      if (!table) {
        return;
      }

      editor.view.dispatch(
        editor.state.tr
          .setNodeMarkup(table.pos, undefined, {
            ...table.node.attrs,
            widthMode: nextMode,
          })
          .scrollIntoView(),
      );
      editor.commands.focus();
    },
    [editor],
  );

  return (
    <BlockWidthModeSelector
      value={widthMode}
      onChange={setWidthMode}
      label={t("Table width")}
    />
  );
};
