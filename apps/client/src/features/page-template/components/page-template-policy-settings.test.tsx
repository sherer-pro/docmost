// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    leftSection?: React.ReactNode;
    variant?: string;
  }) => {
    void variant;
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
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPolicyGroups.mockResolvedValue({ items: [], nextCursor: null });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(spaceId = "space-1") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<PageTemplateSpacePolicySettings spaceId={spaceId} />);
    });
  }

  function rerender(spaceId: string) {
    act(() => {
      root?.render(<PageTemplateSpacePolicySettings spaceId={spaceId} />);
    });
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("shows inherited deployment and workspace gates and disables local controls", async () => {
    mocks.getSpacePolicy.mockResolvedValue(
      policy({ systemEnabled: true, workspaceEnabled: false }),
    );
    render();
    await settle();

    expect(container?.textContent).toContain("Deployment: Enabled");
    expect(container?.textContent).toContain("Workspace: Disabled");
    expect(container?.textContent).toContain("Space: Disabled");
    expect(container?.textContent).toContain(
      "Page templates are disabled for this workspace.",
    );
    expect(
      container?.querySelector<HTMLInputElement>(
        'input[aria-label="Enable page templates in this space"]',
      )?.disabled,
    ).toBe(true);
  });

  it("reloads the latest policy after a revision conflict", async () => {
    mocks.getSpacePolicy.mockResolvedValue(policy());
    mocks.updateSpacePolicy.mockRejectedValue({ response: { status: 409 } });
    render();
    await settle();

    const regular = container?.querySelector<HTMLInputElement>(
      'input[aria-label="Allow independent copies"]',
    );
    await act(async () => regular?.click());
    await settle();

    expect(mocks.updateSpacePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 3 }),
      { allowRegularTemplate: false },
    );
    expect(mocks.getSpacePolicy).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledWith({
      color: "red",
      message: "The page changed. Refresh and try again.",
    });
    expect(
      container?.querySelector<HTMLInputElement>(
        'input[aria-label="Allow independent copies"]',
      )?.disabled,
    ).toBe(false);
  });

  it("offers retry when the group list fails to load", async () => {
    mocks.getSpacePolicy.mockResolvedValue(policy());
    mocks.getPolicyGroups
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    render();
    await settle();

    expect(container?.textContent).toContain("Could not load templates");
    const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => retry?.click());
    await settle();

    expect(mocks.getPolicyGroups).toHaveBeenCalledTimes(2);
    expect(
      container?.querySelector('select[aria-label="Groups"]'),
    ).not.toBeNull();
  });

  it("loads every group page before showing the searchable selector", async () => {
    mocks.getSpacePolicy.mockResolvedValue(policy());
    mocks.getPolicyGroups
      .mockResolvedValueOnce({
        items: [{ id: "group-1", name: "First" }],
        nextCursor: "groups-page-2",
      })
      .mockResolvedValueOnce({
        items: [{ id: "group-2", name: "Second" }],
        nextCursor: null,
      });

    render();
    await settle();

    expect(mocks.getPolicyGroups).toHaveBeenNthCalledWith(1, "space-1", {
      limit: 50,
      cursor: undefined,
    });
    expect(mocks.getPolicyGroups).toHaveBeenNthCalledWith(2, "space-1", {
      limit: 50,
      cursor: "groups-page-2",
    });
  });

  it("ignores a stale group-policy response after the selected group changes", async () => {
    const first = deferred<Record<string, unknown>>();
    const second = deferred<Record<string, unknown>>();
    mocks.getSpacePolicy.mockResolvedValue(policy());
    mocks.getPolicyGroups.mockResolvedValue({
      items: [
        { id: "group-a", name: "Group A" },
        { id: "group-b", name: "Group B" },
      ],
      nextCursor: null,
    });
    mocks.getGroupPolicy.mockImplementation(
      (_spaceId: string, groupId: string) =>
        groupId === "group-a" ? first.promise : second.promise,
    );
    mocks.updateGroupPolicy.mockImplementation(async (current) => current);

    render();
    await settle();
    const select = container?.querySelector<HTMLSelectElement>(
      'select[aria-label="Groups"]',
    );

    await act(async () => {
      setSelectValue(select, "group-a");
    });
    await act(async () => {
      setSelectValue(select, "group-b");
      second.resolve(groupPolicy("group-b"));
      await second.promise;
    });
    await act(async () => {
      first.resolve(groupPolicy("group-a"));
      await first.promise;
    });

    const inherit = container?.querySelector<HTMLInputElement>(
      'input[aria-label="Inherit from space policy"]',
    );
    await act(async () => inherit?.click());

    expect(mocks.updateGroupPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "group-b" }),
      null,
    );
  });

  it("ignores policy and group responses from the previous space", async () => {
    const policyA = deferred<Record<string, unknown>>();
    const policyB = deferred<Record<string, unknown>>();
    const groupsA = deferred<{
      items: Array<{ id: string; name: string }>;
      nextCursor: null;
    }>();
    const groupsB = deferred<{
      items: Array<{ id: string; name: string }>;
      nextCursor: null;
    }>();
    mocks.getSpacePolicy.mockImplementation((spaceId: string) =>
      spaceId === "space-1" ? policyA.promise : policyB.promise,
    );
    mocks.getPolicyGroups.mockImplementation((spaceId: string) =>
      spaceId === "space-1" ? groupsA.promise : groupsB.promise,
    );
    mocks.updateSpacePolicy.mockImplementation(async (current) => current);

    render("space-1");
    rerender("space-2");
    await act(async () => {
      policyB.resolve(policy({ spaceId: "space-2" }));
      groupsB.resolve({
        items: [{ id: "group-b", name: "Group B" }],
        nextCursor: null,
      });
      await Promise.all([policyB.promise, groupsB.promise]);
    });
    await act(async () => {
      policyA.resolve(policy({ spaceId: "space-1" }));
      groupsA.resolve({
        items: [{ id: "group-a", name: "Group A" }],
        nextCursor: null,
      });
      await Promise.all([policyA.promise, groupsA.promise]);
    });

    const groupOptions = Array.from(
      container?.querySelectorAll('select[aria-label="Groups"] option') ?? [],
    ).map((option) => option.textContent);
    expect(groupOptions).toContain("Group B");
    expect(groupOptions).not.toContain("Group A");

    const regular = container?.querySelector<HTMLInputElement>(
      'input[aria-label="Allow independent copies"]',
    );
    await act(async () => regular?.click());
    expect(mocks.updateSpacePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-2" }),
      { allowRegularTemplate: false },
    );
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
