import { createContext, useContext } from "react";

export const EditorIsolationContext = createContext(false);
export const useEditorIsolation = () => useContext(EditorIsolationContext);
