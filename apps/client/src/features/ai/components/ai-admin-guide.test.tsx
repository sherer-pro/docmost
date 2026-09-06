// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AI_ADMIN_GUIDE_ANCHORS,
  type AiAdminGuideAnchor,
} from "./ai-admin-guide-content";
import AiAdminGuide from "./ai-admin-guide";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn(async () => ({
    svg: "<svg><text>Architecture</text></svg>",
  })),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: renderMock,
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => `guide-${Math.random()}`),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function HistoryControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="hash">{location.hash}</output>
      <button type="button" data-testid="back" onClick={() => navigate(-1)}>
        Back
      </button>
    </div>
  );
}

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
  });

  async function renderGuide(path = "/settings/ai/guide") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <MantineProvider>
          <MemoryRouter initialEntries={[path]}>
            <HistoryControls />
            <AiAdminGuide />
          </MemoryRouter>
        </MantineProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    return container;
  }

  async function click(element: Element) {
    await act(async () => {
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function activeAnchors(view: HTMLElement): string[] {
    return AI_ADMIN_GUIDE_ANCHORS.filter((anchor) =>
      view.querySelector(`#${anchor}`),
    );
  }

  it("shows the compact overview when the URL has no supported hash", async () => {
    const view = await renderGuide();

    expect(view.textContent).toContain("ai.adminGuide.overview.title");
    expect(activeAnchors(view)).toEqual([]);
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(view.textContent).toContain("ai.adminGuide.navigation.selectLabel");
    expect(view.querySelector('input[value="overview"]')).toBeTruthy();
    expect(view.querySelector('[aria-current="page"]')?.textContent).toContain(
      "ai.adminGuide.navigation.overview",
    );
  });

  for (const anchor of AI_ADMIN_GUIDE_ANCHORS) {
    it(`opens only the ${anchor} panel from its stable deep link`, async () => {
      const view = await renderGuide(`/settings/ai/guide#${anchor}`);

      expect(activeAnchors(view)).toEqual([anchor]);
      expect(
        view.querySelector(`[aria-current="page"]`)?.getAttribute("href"),
      ).toBe(`/settings/ai/guide#${anchor}`);
    });
  }

  it("switches panels through hash navigation and browser history", async () => {
    const view = await renderGuide();
    const assistantLink = view.querySelector(
      'a[href="/settings/ai/guide#assistant"]',
    );
    expect(assistantLink).toBeTruthy();
    await click(assistantLink!);
    expect(activeAnchors(view)).toEqual(["assistant"]);
    expect(view.querySelector('[data-testid="hash"]')?.textContent).toBe(
      "#assistant",
    );

    const ragLink = view.querySelector('a[href="/settings/ai/guide#rag-api"]');
    expect(ragLink).toBeTruthy();
    await click(ragLink!);
    expect(activeAnchors(view)).toEqual(["rag-api"]);

    await click(view.querySelector('[data-testid="back"]')!);
    expect(activeAnchors(view)).toEqual(["assistant"]);
  });

  it("keeps the scenario CTA, contextual copy controls, and details collapsed", async () => {
    const view = await renderGuide("/settings/ai/guide#rag-sync");

    expect(view.querySelector('a[href="/settings/ai/spaces"]')).toBeTruthy();
    expect(
      view.querySelectorAll(
        'button[aria-label="Copy"], button[aria-label="ai.adminGuide.copy"]',
      ),
    ).toHaveLength(5);
    expect(view.textContent).toContain("RAG_SYNC_ENABLED");
    expect(view.textContent).toContain("RAG_SYNC_ALLOWED_ORIGINS");
    expect(view.textContent).toContain("RAG_SYNC_METADATA_WRITE_VERSION");
    expect(view.textContent).toContain("RAG_CONTENT_PROCESSORS_ENABLED");
    expect(view.textContent).toContain(
      "/api/spaces/:spaceId/ai/rag-sync/actions/test",
    );

    const details = Array.from(view.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("ai.adminGuide.labels.technicalDetails"),
    );
    expect(details?.getAttribute("aria-expanded")).toBe("false");
    await click(details!);
    expect(details?.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps security details and troubleshooting groups on demand", async () => {
    const security = await renderGuide("/settings/ai/guide#security");
    const matrix = Array.from(security.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("ai.adminGuide.security.matrixTitle"),
    );
    expect(matrix?.getAttribute("aria-expanded")).toBe("false");

    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;

    const troubleshooting = await renderGuide(
      "/settings/ai/guide#troubleshooting",
    );
    const groupButtons = Array.from(
      troubleshooting.querySelectorAll("button"),
    ).filter((button) =>
      button.textContent?.includes("ai.adminGuide.troubleshooting.groups."),
    );
    expect(groupButtons).toHaveLength(4);
    expect(
      groupButtons.every(
        (button) => button.getAttribute("aria-expanded") === "false",
      ),
    ).toBe(true);
  });

  it.each([
    ["assistant", "/settings/ai/spaces"],
    ["retrieval", "/settings/ai/spaces"],
    ["rag-api", "/settings/keys/rag"],
    ["rag-sync", "/settings/ai/spaces"],
    ["inbound-mcp", "/settings/keys/mcp"],
    ["outbound-mcp", "/settings/ai/external-tools"],
  ] satisfies readonly [AiAdminGuideAnchor, string][])(
    "keeps the %s CTA route",
    async (anchor, href) => {
      const view = await renderGuide(`/settings/ai/guide#${anchor}`);
      expect(view.querySelector(`a[href="${href}"]`)).toBeTruthy();
    },
  );
});
