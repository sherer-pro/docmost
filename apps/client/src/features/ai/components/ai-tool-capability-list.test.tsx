// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiBuiltinToolCatalogEntry } from "@docmost/api-contract";
import { AiToolCapabilityList } from "./ai-tool-capability-list";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      ({
        "ai.toolPolicy.category.page_read": "Page reading",
        "ai.toolPolicy.categorySelection": "1 of 1 selected",
        "ai.toolPolicy.tool.getPage": "Read page content",
        "ai.toolPolicy.copyCapabilityIdentifier": `Copy technical capability identifier: ${values?.capability}`,
      })[key] ?? key,
  }),
}));

vi.mock("@mantine/core", () => ({
  Checkbox: ({
    label,
    description,
  }: {
    label: React.ReactNode;
    description?: React.ReactNode;
  }) => (
    <label>
      <input type="checkbox" />
      {label}
      {description}
    </label>
  ),
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Paper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tabler/icons-react", () => ({
  IconCheck: () => <span aria-hidden="true">check</span>,
  IconCopy: () => <span aria-hidden="true">copy</span>,
}));

vi.mock("@/components/common/copy-button.tsx", () => ({
  CopyButton: ({
    children,
  }: {
    children: (payload: {
      copied: boolean;
      copy: () => void;
    }) => React.ReactNode;
  }) => children({ copied: false, copy: vi.fn() }),
}));

vi.mock("@/components/ui/accessible-action-icon.tsx", () => ({
  AccessibleActionIcon: ({
    children,
    label,
    onClick,
  }: {
    children: React.ReactNode;
    label: string;
    onClick: () => void;
  }) => (
    <button type="button" aria-label={label} onClick={onClick}>
      {children}
    </button>
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const catalog: AiBuiltinToolCatalogEntry[] = [
  {
    name: "getPage",
    capability: "page.content.read",
    category: "page_read",
    targetScope: "readable_page",
    approvalMode: "none",
    maxResultBytes: 1,
    writeClass: "read_only",
    exposures: ["agent", "mcp"],
    annotations: {
      idempotent: true,
      destructive: false,
      openWorld: false,
    },
  },
];

describe("AiToolCapabilityList", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = null;
    container = null;
  });

  it("moves the technical capability identifier behind an accessible copy action", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <AiToolCapabilityList
          catalog={catalog}
          allowed={["page.content.read"]}
          onChange={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Read page content");
    expect(container.textContent).not.toContain("page.content.read");
    expect(
      container.querySelector(
        'button[aria-label="Copy technical capability identifier: page.content.read"]',
      ),
    ).not.toBeNull();
  });
});
