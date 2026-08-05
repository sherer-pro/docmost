// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Tree, type NodeRendererProps } from "react-arborist";
import { afterEach, describe, expect, it, vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type TestTreeNode = {
  id: string;
  name: string;
  children?: TestTreeNode[];
};

const rootPage: TestTreeNode = {
  id: "root-page",
  name: "Root page",
};

const databasePage: TestTreeNode = {
  id: "database-page",
  name: "Database page",
};

function TestNode({ node, style, dragHandle }: NodeRendererProps<TestTreeNode>) {
  return (
    <div ref={dragHandle} style={style} data-node-id={node.id}>
      {node.data.name}
    </div>
  );
}

describe("controlled active tree selection", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
  });

  async function renderTree(data: TestTreeNode[], selection?: string) {
    if (!container) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <Tree
          data={data}
          selection={selection}
          width={320}
          height={240}
          rowHeight={30}
          disableDrag
          disableDrop
          disableEdit
        >
          {TestNode}
        </Tree>,
      );
      await Promise.resolve();
    });
  }

  function selectedNodeIds(): string[] {
    return Array.from(
      container?.querySelectorAll('[role="treeitem"][aria-selected="true"]') ??
        [],
    ).map(
      (element) =>
        element.querySelector<HTMLElement>("[data-node-id]")?.dataset.nodeId ??
        "",
    );
  }

  it("selects a root page on the first render", async () => {
    await renderTree([rootPage, databasePage], rootPage.id);

    expect(selectedNodeIds()).toEqual([rootPage.id]);
  });

  it("moves selection from a page to a database", async () => {
    await renderTree([rootPage, databasePage], rootPage.id);
    await renderTree([rootPage, databasePage], databasePage.id);

    expect(selectedNodeIds()).toEqual([databasePage.id]);
  });

  it("selects a node that appears after its route becomes active", async () => {
    await renderTree([rootPage], databasePage.id);
    await renderTree([rootPage, databasePage], databasePage.id);

    expect(selectedNodeIds()).toEqual([databasePage.id]);
  });

  it("clears selection outside page and database routes", async () => {
    await renderTree([rootPage, databasePage], rootPage.id);
    await renderTree([rootPage, databasePage]);

    expect(selectedNodeIds()).toEqual([]);
  });
});
