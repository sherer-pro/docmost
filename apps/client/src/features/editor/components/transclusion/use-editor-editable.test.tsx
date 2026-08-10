// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorEditable } from "./use-editor-editable";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useEditorEditable", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    for (const container of containers.splice(0)) container.remove();
  });

  it("updates node-view state after the editor switches modes", () => {
    let update: (() => void) | undefined;
    const editor = {
      isEditable: false,
      on: vi.fn((_event: string, handler: () => void) => {
        update = handler;
      }),
      off: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    function Probe() {
      return <span>{useEditorEditable(editor as never) ? "edit" : "read"}</span>;
    }

    act(() => root.render(<Probe />));
    expect(container.textContent).toBe("read");

    act(() => {
      editor.isEditable = true;
      update?.();
    });
    expect(container.textContent).toBe("edit");
    expect(editor.on).toHaveBeenCalledWith("update", expect.any(Function));
  });
});
