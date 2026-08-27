import { EditorProvider } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";
import { memo, useEffect, useRef, useState } from "react";
import type { DragEvent, SyntheticEvent } from "react";
import classes from "./transclusion.module.css";

type Props = {
  content: unknown;
  renderEditor?: boolean;
  version?: string;
  extensions: Extensions;
};

function TransclusionContent({
  content,
  renderEditor = true,
  version,
  extensions,
}: Props) {
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
  // - the mouse selection lifecycle would otherwise reach the host editor,
  //   node-select the atom wrapper, and clear native text selection inside.
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
      onMouseDownCapture={stopPropagation}
      onMouseDown={stopPropagation}
      onMouseMoveCapture={stopPropagation}
      onMouseMove={stopPropagation}
      onMouseUpCapture={stopPropagation}
      onMouseUp={stopPropagation}
      onClick={stopPropagation}
      onDragStart={stopPropagation}
      onDragOver={stopFileDropPropagation}
      onDrop={stopFileDropPropagation}
    >
      {renderEditor && (
        <EditorProvider
          key={version}
          editable={false}
          immediatelyRender={false}
          shouldRerenderOnTransaction={false}
          extensions={extensions}
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
