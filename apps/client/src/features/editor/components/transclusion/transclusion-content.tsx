import { EditorProvider } from "@tiptap/react";
import { memo, useEffect, useRef, useState } from "react";
import type { DragEvent, SyntheticEvent } from "react";
import { transclusionContentExtensions } from "@/features/editor/extensions/extensions";
import classes from "./transclusion.module.css";

type Props = {
  content: unknown;
  renderEditor?: boolean;
};

function TransclusionContent({ content, renderEditor = true }: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(() => {
    const element = contentRef.current;
    if (!renderEditor || !element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height && height > 0) setMeasuredHeight(Math.ceil(height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [renderEditor]);

  // Isolate the nested read-only editor's events from the host editor:
  // - mousedown/click would otherwise make the host node-select the atom
  //   wrapper, blocking native text selection inside.
  // - dragstart from the nested view must not initiate a host block drag
  // - external file dragover/drop must stay isolated to avoid duplicate
  //   uploads, while ProseMirror block drags must reach the host editor.
  return (
    <div
      ref={contentRef}
      className={classes.transclusionContent}
      style={
        renderEditor
          ? undefined
          : { height: measuredHeight ?? 24, overflow: "hidden" }
      }
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
      onDragStart={stopPropagation}
      onDragOver={stopFileDropPropagation}
      onDrop={stopFileDropPropagation}
    >
      {renderEditor && (
        <EditorProvider
          editable={false}
          immediatelyRender={false}
          shouldRerenderOnTransaction={false}
          extensions={transclusionContentExtensions}
          content={content as any}
        />
      )}
    </div>
  );
}

function stopPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

function stopFileDropPropagation(event: DragEvent) {
  if (Array.from(event.dataTransfer.types).includes("Files")) {
    event.stopPropagation();
  }
}

export default memo(TransclusionContent);
