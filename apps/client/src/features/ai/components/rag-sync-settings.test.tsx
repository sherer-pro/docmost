// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import type { RagSyncSpaceConfig } from "@docmost/api-contract";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { RagSyncSettings } from "./rag-sync-settings";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  config: null as RagSyncSpaceConfig | null,
  retrieval: {
    adapter: "none",
    openWebUi: { baseUrl: null, knowledgeId: null },
  },
  update: vi.fn(),
  test: vi.fn(),
  action: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: mocks.notify },
}));

vi.mock("@/features/ai/queries/ai-query.ts", () => ({
  useAiSpaceConfigQuery: () => ({
    data: { retrieval: mocks.retrieval },
  }),
}));

vi.mock("@/features/ai/queries/rag-sync-query.ts", () => ({
  useRagSyncSpaceConfigQuery: () => ({
    data: mocks.config,
    isLoading: false,
    isError: false,
  }),
  useUpdateRagSyncSpaceConfigMutation: () => ({
    mutateAsync: mocks.update,
    isPending: false,
  }),
  useTestRagSyncTargetMutation: () => ({
    mutateAsync: mocks.test,
    isPending: false,
  }),
  useRagSyncActionMutation: () => ({
    mutateAsync: mocks.action,
    isPending: false,
  }),
}));

function config(
  overrides: Partial<RagSyncSpaceConfig> = {},
): RagSyncSpaceConfig {
  return {
    deploymentEnabled: true,
    bindingId: "binding-id",
    state: "disabled",
    configVersion: 4,
    target: {
      adapter: "open-webui-knowledge-v1",
      baseUrl: "https://old.example.com",
      knowledgeId: "old-knowledge",
      writerApiKeyConfigured: true,
      lastTestedAt: null,
    },
    cleanupRequired: false,
    status: {
      health: "disabled",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lagMs: null,
      errorCode: null,
    },
    ...overrides,
  };
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

describe("RagSyncSettings", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    mocks.config = config();
    mocks.retrieval = {
      adapter: "none",
      openWebUi: { baseUrl: null, knowledgeId: null },
    };
    mocks.update.mockReset();
    mocks.test.mockReset();
    mocks.action.mockReset();
    mocks.notify.mockReset();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function renderSettings() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <MantineProvider>
          <RagSyncSettings spaceId="space-id" />
        </MantineProvider>,
      );
      await Promise.resolve();
    });
    return container;
  }

  async function setInput(input: HTMLInputElement, value: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function clickButton(view: HTMLElement, text: string) {
    const button = Array.from(view.querySelectorAll("button")).find((item) =>
      item.textContent?.includes(text),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("saves a changed target before running writer verification", async () => {
    mocks.config = config({
      bindingId: null,
      configVersion: null,
      target: {
        adapter: "open-webui-knowledge-v1",
        baseUrl: null,
        knowledgeId: null,
        writerApiKeyConfigured: false,
        lastTestedAt: null,
      },
    });
    const saved = config({ configVersion: 1 });
    mocks.update.mockResolvedValue(saved);
    mocks.test.mockResolvedValue({ latencyMs: 42, config: saved });
    const view = await renderSettings();
    const [baseUrl, knowledgeId, writerApiKey] = Array.from(
      view.querySelectorAll("input"),
    ) as HTMLInputElement[];

    await setInput(baseUrl, "https://open-webui.example.com");
    await setInput(knowledgeId, "knowledge-id");
    await setInput(writerApiKey, "secret-writer-key");
    await clickButton(view, "ai.ragSync.saveAndTest");

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: null,
        target: expect.objectContaining({
          baseUrl: "https://open-webui.example.com",
          knowledgeId: "knowledge-id",
          writerApiKey: "secret-writer-key",
        }),
      }),
    );
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.test.mock.invocationCallOrder[0],
    );
  });

  it("rotates the writer key before retrying cleanup with the new version", async () => {
    mocks.config = config({ cleanupRequired: true });
    const saved = config({ cleanupRequired: true, configVersion: 5 });
    mocks.update.mockResolvedValue(saved);
    mocks.action.mockResolvedValue(saved);
    const view = await renderSettings();
    const writerApiKey = view.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;

    await setInput(writerApiKey, "rotated-writer-key");
    await clickButton(view, "ai.ragSync.saveKeyAndRetryCleanup");

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 4,
        target: expect.objectContaining({
          writerApiKey: "rotated-writer-key",
        }),
      }),
    );
    expect(mocks.action).toHaveBeenCalledWith({
      action: "retry-cleanup",
      expectedVersion: 5,
    });
  });

  it("copies the space-search target and keeps actions text-labelled", async () => {
    mocks.retrieval = {
      adapter: "open-webui-knowledge-v1",
      openWebUi: {
        baseUrl: "https://search.example.com",
        knowledgeId: "search-knowledge",
      },
    };
    const view = await renderSettings();

    expect(view.textContent).toContain("ai.ragSync.targetMismatchDescription");
    await clickButton(view, "ai.ragSync.useRetrievalTarget");
    const [baseUrl, knowledgeId] = Array.from(
      view.querySelectorAll("input"),
    ) as HTMLInputElement[];
    expect(baseUrl.value).toBe("https://search.example.com");
    expect(knowledgeId.value).toBe("search-knowledge");
    expect(
      Array.from(view.querySelectorAll("button")).every((button) =>
        Boolean(
          button.getAttribute("aria-label") || button.textContent?.trim(),
        ),
      ),
    ).toBe(true);
  });
});
