// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorPageId } from "./use-editor-page-id";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useEditorPageId", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    for (const container of containers.splice(0)) container.remove();
  });

  it("observes a page id assigned during editor creation", async () => {
    let onCreate: (() => void) | undefined;
    const editor = {
      storage: {} as { pageId?: string },
      on: vi.fn((_event: string, handler: () => void) => {
        onCreate = handler;
      }),
      off: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    function Probe() {
      return <span>{useEditorPageId(editor as never) ?? "missing"}</span>;
    }

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("missing");

    await act(async () => {
      editor.storage.pageId = "page-1";
      onCreate?.();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("page-1");
    expect(editor.on).toHaveBeenCalledWith("create", expect.any(Function));
  });
});
