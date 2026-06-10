import { Excalidraw, useHandleLibrary } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useState } from "react";
import { localStorageLibraryAdapter } from "@/features/editor/components/excalidraw/excalidraw-utils.ts";

interface ExcalidrawEditorProps {
  initialData: any;
  onApiChange: (api: ExcalidrawImperativeAPI) => void;
  theme: "light" | "dark";
}

export default function ExcalidrawEditor({
  initialData,
  onApiChange,
  theme,
}: ExcalidrawEditorProps) {
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI>(null);

  useHandleLibrary({
    excalidrawAPI,
    adapter: localStorageLibraryAdapter,
  });

  const handleApiChange = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      setExcalidrawAPI(api);
      onApiChange(api);
    },
    [onApiChange],
  );

  return (
    <Excalidraw
      excalidrawAPI={handleApiChange}
      initialData={{
        ...initialData,
        scrollToContent: true,
      }}
      theme={theme}
    />
  );
}
