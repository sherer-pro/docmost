// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Provider, atom, createStore, useAtom, useAtomValue } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { IsolatedEditorScope } from "./isolated-editor-scope";
import { pageEditorAtom } from "./atoms/editor-atoms";
import { searchAndReplaceStateAtom } from "./components/search-and-replace/atoms/search-and-replace-state-atom";
import { useEditorIsolation } from "./editor-isolation-context";

describe("record editor scope", () => {
  it("isolates editor and find state while sharing unrelated user state with the parent", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const shared = atom("initial");
    const parent = createStore();
    const parentEditor = { id: "database-editor" } as any;
    parent.set(pageEditorAtom, parentEditor);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Probe() {
      const [editor, setEditor] = useAtom(pageEditorAtom);
      const [find, setFind] = useAtom(searchAndReplaceStateAtom);
      const [user, setUser] = useAtom(shared);
      const isolated = useEditorIsolation();
      return (
        <button
          onClick={() => {
            setEditor({ id: "record-editor" } as any);
            setFind({ isOpen: true });
            setUser("updated");
          }}
          data-isolated={String(isolated)}
        >
          {editor?.["id"] ?? "empty"}:{String(find.isOpen)}:{user}
        </button>
      );
    }
    function Parent() {
      const value = useAtomValue(shared);
      return <output>{value}</output>;
    }
    try {
      act(() =>
        root.render(
          <Provider store={parent}>
            <Parent />
            <IsolatedEditorScope>
              <Probe />
            </IsolatedEditorScope>
          </Provider>,
        ),
      );
      const button = container.querySelector("button")!;
      expect(button.textContent).toBe("empty:false:initial");
      expect(button.dataset.isolated).toBe("true");
      act(() => button.click());
      expect(button.textContent).toBe("record-editor:true:updated");
      expect(parent.get(pageEditorAtom)).toBe(parentEditor);
      expect(parent.get(searchAndReplaceStateAtom).isOpen).toBe(false);
      expect(container.querySelector("output")?.textContent).toBe("updated");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
