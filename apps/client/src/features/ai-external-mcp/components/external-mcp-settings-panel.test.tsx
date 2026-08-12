// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import ExternalMcpSettingsPanel from "./external-mcp-settings-panel";

const {
  settingsQueryMock,
  serversQueryMock,
  updateSettingsMock,
  updateServerMock,
  deleteServerMock,
} = vi.hoisted(() => ({
  settingsQueryMock: vi.fn(),
  serversQueryMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  updateServerMock: vi.fn(),
  deleteServerMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {},
  }),
}));

vi.mock("@/features/ai/utils/ai-policies.ts", () => ({
  resolveAiErrorMessage: () => "resolved AI request error",
}));

vi.mock("@/components/ui/empty-state.tsx", () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}));

vi.mock("./external-mcp-server-table.tsx", () => ({
  default: () => <div data-testid="server-table" />,
}));

vi.mock("./external-mcp-server-form-modal.tsx", () => ({
  default: () => <div data-testid="server-form" />,
}));

vi.mock("./external-mcp-server-detail.tsx", () => ({
  default: () => <div data-testid="server-detail" />,
}));

vi.mock("@/features/ai-external-mcp/queries/ai-external-mcp-query.ts", () => ({
  useAiExternalMcpSettingsQuery: settingsQueryMock,
  useAiExternalMcpServersQuery: serversQueryMock,
  useUpdateAiExternalMcpSettingsMutation: updateSettingsMock,
  useUpdateAiExternalMcpServerMutation: updateServerMock,
  useDeleteAiExternalMcpServerMutation: deleteServerMock,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("ExternalMcpSettingsPanel", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    settingsQueryMock.mockReturnValue({
      data: {
        deploymentEnabled: true,
        enabled: false,
        deploymentAllowedOrigins: [],
        allowedOrigins: [],
        policyVersion: 1,
        updatedAt: null,
      },
      isLoading: false,
      isError: false,
    });
    serversQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    updateSettingsMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
    });
    updateServerMock.mockReturnValue({ mutateAsync: vi.fn() });
    deleteServerMock.mockReturnValue({ mutate: vi.fn() });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  function renderPanel() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <MantineProvider>
          <ExternalMcpSettingsPanel />
        </MantineProvider>,
      );
    });
    return container;
  }

  function buttonByText(view: HTMLElement, text: string) {
    return Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent === text,
    );
  }

  it("blocks impossible setup actions when the deployment allowlist is empty", () => {
    const view = renderPanel();

    expect(view.textContent).toContain("ai.externalTools.allowedOriginsEmpty");
    expect(
      view.querySelector<HTMLInputElement>(
        'input[placeholder="https://mcp.example.com"]',
      )?.disabled,
    ).toBe(true);
    expect(
      buttonByText(view, "ai.externalTools.saveAllowedOrigins")?.disabled,
    ).toBe(true);
    expect(buttonByText(view, "ai.externalTools.addServer")?.disabled).toBe(
      true,
    );
    expect(
      view.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled,
    ).toBe(true);
  });

  it("allows workspace origin setup but not server creation until an origin is saved", () => {
    settingsQueryMock.mockReturnValue({
      data: {
        deploymentEnabled: true,
        enabled: false,
        deploymentAllowedOrigins: ["https://mcp.example.test"],
        allowedOrigins: [],
        policyVersion: 1,
        updatedAt: null,
      },
      isLoading: false,
      isError: false,
    });

    const view = renderPanel();

    expect(
      view.querySelector<HTMLInputElement>(
        'input[placeholder="https://mcp.example.com"]',
      )?.disabled,
    ).toBe(false);
    expect(
      buttonByText(view, "ai.externalTools.saveAllowedOrigins")?.disabled,
    ).toBe(false);
    expect(buttonByText(view, "ai.externalTools.addServer")?.disabled).toBe(
      true,
    );
    expect(
      view.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled,
    ).toBe(false);
  });

  it("keeps a persisted stale origin editable while the administrator clears it", () => {
    settingsQueryMock.mockReturnValue({
      data: {
        deploymentEnabled: true,
        enabled: true,
        deploymentAllowedOrigins: [],
        allowedOrigins: ["https://stale.example.test"],
        policyVersion: 1,
        updatedAt: null,
      },
      isLoading: false,
      isError: false,
    });

    const view = renderPanel();
    const input = view.querySelector<HTMLInputElement>(
      'input[placeholder="https://mcp.example.com"]',
    );
    expect(input?.disabled).toBe(false);

    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
      );
    });

    expect(view.textContent).not.toContain("https://stale.example.test");
    expect(
      buttonByText(view, "ai.externalTools.saveAllowedOrigins")?.disabled,
    ).toBe(false);
    expect(buttonByText(view, "ai.externalTools.addServer")?.disabled).toBe(
      true,
    );
  });

  it("shows a request error instead of an empty state when the server list fails", () => {
    serversQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    const view = renderPanel();

    expect(view.textContent).toContain("resolved AI request error");
    expect(view.querySelector('[data-testid="empty-state"]')).toBeNull();
  });
});
