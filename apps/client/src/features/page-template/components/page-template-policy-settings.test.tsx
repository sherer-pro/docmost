// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PageTemplateSpacePolicySettings } from "./page-template-policy-settings";

const mocks = vi.hoisted(() => ({
  getSpacePolicy: vi.fn(),
  updateSpacePolicy: vi.fn(),
  getGroupPolicy: vi.fn(),
  updateGroupPolicy: vi.fn(),
  getWorkspacePolicy: vi.fn(),
  updateWorkspacePolicy: vi.fn(),
  getPolicyGroups: vi.fn(),
  notify: vi.fn(),
  t: (key: string, values?: Record<string, unknown>) =>
    Object.entries(values ?? {}).reduce(
      (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
      key,
    ),
}));

vi.mock("@mantine/core", () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Button = ({
    children,
    leftSection,
    variant,
    loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    leftSection?: React.ReactNode;
    variant?: string;
    loading?: boolean;
  }) => {
    void variant;
    void loading;
    return (
      <button type="button" {...props}>
        {leftSection}
        {children}
      </button>
    );
  };
  const Checkbox = ({
    label,
    checked,
    disabled,
    onChange,
  }: {
    label: React.ReactNode;
    checked: boolean;
    disabled?: boolean;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
  }) => (
    <label>
      <input
        type="checkbox"
        aria-label={String(label)}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {label}
    </label>
  );
  const Select = ({
    label,
    disabled,
    data = [],
    value,
    onChange,
  }: {
    label?: React.ReactNode;
    disabled?: boolean;
    data?: Array<{ value: string; label: string }>;
    value?: string | null;
    onChange?: (value: string | null) => void;
  }) => (
    <label>
      {label}
      <select
        aria-label={String(label)}
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.currentTarget.value || null)}
      >
        <option value="" />
        {data.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
  return {
    Center: Wrapper,
    Loader: Wrapper,
    Modal: Wrapper,
    Alert: Wrapper,
    Badge: Wrapper,
    Button,
    Checkbox,
    Divider: Wrapper,
    Group: Wrapper,
    Paper: Wrapper,
    Select,
    Skeleton: () => <div role="status" />,
    Stack: Wrapper,
    Text: Wrapper,
    Tooltip: Wrapper,
  };
});

vi.mock("@tabler/icons-react", () => ({
  IconAlertCircle: () => null,
  IconChevronRight: () => null,
  IconRefresh: () => null,
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: mocks.notify },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));

vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({
    title,
    action,
  }: {
    title: string;
    action?: React.ReactNode;
  }) => (
    <div>
      {title}
      {action}
    </div>
  ),
}));

vi.mock("@/components/ui/responsive-settings-row", () => ({
  ResponsiveSettingsContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResponsiveSettingsControl: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResponsiveSettingsRow: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../services/page-template-api", () => ({
  getPageTemplateGroupPolicy: mocks.getGroupPolicy,
  getPageTemplatePolicyGroups: mocks.getPolicyGroups,
  getPageTemplateSpacePolicy: mocks.getSpacePolicy,
  getPageTemplateWorkspacePolicy: mocks.getWorkspacePolicy,
  updatePageTemplateGroupPolicy: mocks.updateGroupPolicy,
  updatePageTemplateSpacePolicy: mocks.updateSpacePolicy,
  updatePageTemplateWorkspacePolicy: mocks.updateWorkspacePolicy,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("PageTemplateSpacePolicySettings", () => {
  let client: QueryClient;
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.resetAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.getPolicyGroups.mockResolvedValue({ items: [], nextCursor: null });
  });

  afterEach(() => {
    act(() => root?.unmount());
    client.clear();
    container?.remove();
    root = null;
    container = null;
  });

  function render(spaceId = "space-1") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <QueryClientProvider client={client}>
          <PageTemplateSpacePolicySettings spaceId={spaceId} />
        </QueryClientProvider>,
      );
    });
  }

  function rerender(spaceId: string) {
    act(() => {
      root?.render(
        <QueryClientProvider client={client}>
          <PageTemplateSpacePolicySettings spaceId={spaceId} />
        </QueryClientProvider>,
      );
    });
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const input = (label: string) =>
    container!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const submit = async (index = 0) => {
    const form = container!.querySelectorAll("form").item(index);
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await settle();
  };

  it("keeps edits local until Save and ignores the retired workspace gate", async () => {
    mocks.getSpacePolicy.mockResolvedValue(policy({ workspaceEnabled: false }));
    mocks.updateSpacePolicy.mockImplementation(async (initial, value) => ({
      ...initial,
      ...value,
      revision: 4,
    }));
    render();
    await settle();
    await settle();
    await act(async () => input("Allow independent copies").click());
    expect(mocks.updateSpacePolicy).not.toHaveBeenCalled();
    await submit();
    expect(mocks.updateSpacePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 3 }),
      expect.objectContaining({ allowRegularTemplate: false }),
    );
    expect(mocks.getWorkspacePolicy).not.toHaveBeenCalled();
  });
  it("preserves failed input across a background refetch and retries with the original revision", async () => {
    mocks.getSpacePolicy.mockResolvedValue(policy());
    mocks.updateSpacePolicy
      .mockRejectedValueOnce({ response: { status: 409 } })
      .mockImplementation(async (_, value) => ({ ...value, revision: 4 }));
    render();
    await settle();
    await settle();
    await act(async () => input("Allow independent copies").click());
    await submit();
    expect(container!.textContent).toContain("spaceAdmin.conflictDescription");
    await act(async () =>
      client.setQueryData(
        ["page-templates", "space-policy", "space-1"],
        policy({ revision: 5 }),
      ),
    );
    expect(input("Allow independent copies").checked).toBe(false);
    await submit();
    expect(mocks.updateSpacePolicy.mock.calls[1][0].revision).toBe(3);
  });
  it("saves the selected group independently with its own revision", async () => {
    mocks.getSpacePolicy.mockResolvedValue(policy());
    mocks.getPolicyGroups.mockResolvedValue({
      items: [{ id: "group-a", name: "Group A" }],
      nextCursor: null,
    });
    mocks.getGroupPolicy.mockResolvedValue(groupPolicy("group-a"));
    mocks.updateGroupPolicy.mockImplementation(
      async (initial, allowedActions) => ({
        ...initial,
        allowedActions,
        revision: 2,
      }),
    );
    render();
    await settle();
    await settle();
    await act(async () =>
      setSelectValue(container!.querySelector("select"), "group-a"),
    );
    await vi.waitFor(async () => {
      await settle();
      expect(input("Inherit from space policy")).not.toBeNull();
    });
    await act(async () => input("Inherit from space policy").click());
    expect(mocks.updateGroupPolicy).not.toHaveBeenCalled();
    await submit(1);
    expect(mocks.updateGroupPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "group-a", revision: 1 }),
      null,
    );
    expect(mocks.updateSpacePolicy).not.toHaveBeenCalled();
  });
  it("discards edits only when Cancel is chosen", async () => {
    mocks.getSpacePolicy.mockResolvedValue(policy());
    render();
    await settle();
    await settle();
    await act(async () => input("Allow independent copies").click());
    const cancel = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    )!;
    await act(async () => cancel.click());
    expect(input("Allow independent copies").checked).toBe(true);
    expect(mocks.updateSpacePolicy).not.toHaveBeenCalled();
  });
  it("ignores a late response for a previous space", async () => {
    const old = deferred<ReturnType<typeof policy>>();
    mocks.getSpacePolicy.mockImplementation((id) =>
      id === "space-1"
        ? old.promise
        : Promise.resolve(policy({ spaceId: id, allowRegularTemplate: false })),
    );
    render();
    rerender("space-2");
    await settle();
    await settle();
    await act(async () => old.resolve(policy()));
    await settle();
    expect(input("Allow independent copies").checked).toBe(false);
  });
});

function policy(overrides: Record<string, unknown> = {}) {
  return {
    spaceId: "space-1",
    systemEnabled: true,
    workspaceEnabled: true,
    templatesEnabled: true,
    allowCreateTemplate: true,
    allowRegularTemplate: true,
    allowSyncedTemplate: true,
    revision: 3,
    ...overrides,
  };
}

function groupPolicy(groupId: string) {
  return {
    groupId,
    spaceId: "space-1",
    allowedActions: [],
    revision: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function setSelectValue(
  select: HTMLSelectElement | null | undefined,
  value: string,
) {
  if (!select) return;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
