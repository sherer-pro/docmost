// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTreeMutation } from "./use-tree-mutation";
import type { SpaceTreeNode } from "@/features/page/tree/types.ts";

const mocks = vi.hoisted(() => ({
  movePage: vi.fn(),
  setTreeData: vi.fn(),
  updateCacheOnMovePage: vi.fn(),
  emit: vi.fn(),
  navigate: vi.fn(),
  setUser: vi.fn(),
  treeDataAtom: Symbol("treeDataAtom"),
  userAtom: Symbol("userAtom"),
}));

let treeData: SpaceTreeNode[] = [];

vi.mock("react-dnd", () => ({
  useDragDropManager: () => ({
    getMonitor: () => ({ getDropResult: () => null }),
  }),
}));

vi.mock("jotai", () => ({
  useAtom: (atom: symbol) =>
    atom === mocks.treeDataAtom
      ? [treeData, mocks.setTreeData]
      : [null, mocks.setUser],
}));

vi.mock("@/features/page/tree/atoms/tree-data-atom.ts", () => ({
  treeDataAtom: mocks.treeDataAtom,
}));

vi.mock("@/features/user/atoms/current-user-atom.ts", () => ({
  userAtom: mocks.userAtom,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => ({ spaceSlug: "space", pageSlug: "page" }),
  };
});

vi.mock("@/features/page/queries/page-query.ts", () => ({
  useCreatePageMutation: () => ({ mutateAsync: vi.fn() }),
  useUpdatePageMutation: () => ({ mutateAsync: vi.fn() }),
  useRemovePageMutation: () => ({ mutateAsync: vi.fn() }),
  useMovePageMutation: () => ({ mutateAsync: mocks.movePage }),
  updateCacheOnMovePage: mocks.updateCacheOnMovePage,
}));

vi.mock("@/features/websocket/use-query-emit.ts", () => ({
  useQueryEmit: () => mocks.emit,
}));

vi.mock("@/features/user/utils/page-edit-mode.ts", () => ({
  buildPageEditModeByPageId: vi.fn(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function node(id: string, position: string): SpaceTreeNode {
  return {
    id,
    name: id,
    nodeType: "page",
    slugId: `${id}-slug`,
    position,
    parentPageId: null,
    spaceId: "space-1",
    hasChildren: false,
    children: [],
  };
}

describe("useTreeMutation move reconciliation", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let hook: ReturnType<typeof useTreeMutation<SpaceTreeNode>> | null = null;

  function Consumer() {
    hook = useTreeMutation<SpaceTreeNode>("space-1");
    return null;
  }

  function renderHook() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<Consumer />));
  }

  function moveArgs() {
    const draggedData = treeData[0];
    const previousParent = {
      id: "__REACT_ARBORIST_INTERNAL_ROOT__",
      children: [{ id: draggedData.id }],
    };

    return {
      dragIds: [draggedData.id],
      dragNodes: [
        {
          data: draggedData,
          parent: previousParent,
        },
      ],
      parentId: null,
      parentNode: null,
      index: 2,
    } as any;
  }

  function resolveTreeDataCall(callIndex = 0): SpaceTreeNode[] {
    const value = mocks.setTreeData.mock.calls[callIndex][0];
    return typeof value === "function" ? value(treeData) : value;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    treeData = [node("page-a", "a0"), node("page-b", "a1")];
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    hook = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not publish a phantom order before the server accepts the move", async () => {
    let resolveMove: (() => void) | undefined;
    mocks.movePage.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveMove = resolve;
      }),
    );
    renderHook();

    let pendingMove: Promise<void> | undefined;
    act(() => {
      pendingMove = hook?.controllers.onMove(moveArgs()) as Promise<void>;
    });

    expect(mocks.setTreeData).not.toHaveBeenCalled();

    await act(async () => {
      resolveMove?.();
      await pendingMove;
    });

    expect(mocks.setTreeData).toHaveBeenCalledTimes(1);
    expect(resolveTreeDataCall().map((item) => item.id)).toEqual([
      "page-b",
      "page-a",
    ]);
  });

  it("restores the original order when the server rejects the move", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.movePage.mockRejectedValue(new Error("move rejected"));
    renderHook();

    await act(async () => {
      await hook?.controllers.onMove(moveArgs());
    });

    expect(mocks.setTreeData).toHaveBeenCalledTimes(1);
    expect(resolveTreeDataCall().map((item) => item.id)).toEqual([
      "page-a",
      "page-b",
    ]);
    expect(mocks.updateCacheOnMovePage).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
