// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import AiAdminGuide from "./ai-admin-guide";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn(async () => ({
    svg: "<svg><text>Architecture</text></svg>",
  })),
}));
const scrollIntoViewMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: renderMock,
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => `guide-${Math.random()}`),
}));

function translate(key: string, options?: { version?: number }) {
  if (key.endsWith(".facts")) return "Owner||Prerequisite||Result";
  if (key.endsWith(".operations")) {
    return "Save|Test|Enable||Success signal||Safe rollback";
  }
  if (key.startsWith("ai.adminGuide.troubleshooting.")) {
    return "Problem||Action";
  }
  if (key.endsWith("textAlternative")) return "First|Second|Third";
  if (key.endsWith("overviewNodes")) return "Registry|External|Remote";
  if (key.endsWith("ragNodes")) {
    return "Query|Query key|Index|Indexer|ACL|Writer key|does not call";
  }
  if (key.endsWith("inboundNodes")) return "Keys|Scope|Admission|Policy";
  if (key.endsWith("outboundNodes")) {
    return "Deployment|Workspace|Space|Group|Consent|DNS request";
  }
  if (key === "ai.adminGuide.contractVersion") {
    return `Guide contract v${options?.version}`;
  }
  return key;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoViewMock,
  });
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe("AiAdminGuide", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    renderMock.mockClear();
    scrollIntoViewMock.mockClear();
  });

  async function renderGuide() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <MantineProvider>
          <MemoryRouter initialEntries={["/settings/ai/guide#rag-api"]}>
            <AiAdminGuide />
          </MemoryRouter>
        </MantineProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    return container;
  }

  it("renders stable anchors, direct CTAs, accordions, and copy buttons", async () => {
    const view = await renderGuide();

    for (const anchor of [
      "assistant",
      "retrieval",
      "rag-api",
      "rag-sync",
      "inbound-mcp",
      "outbound-mcp",
      "security",
      "troubleshooting",
    ]) {
      expect(view.querySelector(`#${anchor}`)).toBeTruthy();
      expect(view.querySelector(`a[href="#${anchor}"]`)).toBeTruthy();
    }

    for (const href of [
      "/settings/ai/spaces",
      "/settings/keys/rag",
      "/settings/keys/mcp",
      "/settings/ai/external-tools",
    ]) {
      expect(view.querySelector(`a[href="${href}"]`)).toBeTruthy();
    }

    expect(
      view.querySelectorAll(
        'button[aria-label="Copy"], button[aria-label="ai.adminGuide.copy"]',
      ),
    ).toHaveLength(8);
    expect(
      view.textContent?.match(/ai\.adminGuide\.instructionsTitle/gu),
    ).toHaveLength(6);
    expect(view.textContent).toContain("Success signal");
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });
});
