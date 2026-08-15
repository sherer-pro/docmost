// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateUseModal } from "./page-template-picker";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  destinations: vi.fn(),
  create: vi.fn(),
  notify: vi.fn(),
  onCreated: vi.fn(),
  onClose: vi.fn(),
  t: (key: string, values?: Record<string, unknown>) =>
    Object.entries(values ?? {}).reduce(
      (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
      key,
    ),
}));

vi.mock("@mantine/hooks", () => ({
  useDebouncedValue: (value: unknown) => [value],
  useMediaQuery: () => false,
}));

vi.mock("@mantine/core", () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Text = ({
    children,
    component: Component = "span",
    className,
    ...props
  }: {
    children?: React.ReactNode;
    component?: React.ElementType;
    className?: string;
    [key: string]: unknown;
  }) => {
    const { fw, c, mt, size, lineClamp, ...domProps } = props;
    void fw;
    void c;
    void mt;
    void size;
    void lineClamp;
    return (
      <Component className={className} {...domProps}>
        {children}
      </Component>
    );
  };
  const Button = ({
    children,
    leftSection,
    loading,
    variant,
    color,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    leftSection?: React.ReactNode;
    loading?: boolean;
    variant?: string;
    color?: string;
  }) => {
    void variant;
    void color;
    return (
      <button
        type="button"
        {...props}
        disabled={Boolean(loading) || Boolean(props.disabled)}
      >
        {leftSection}
        {children}
      </button>
    );
  };
  const TextInput = ({
    label,
    value,
    onChange,
    placeholder,
    leftSection,
    autoFocus,
  }: {
    label?: React.ReactNode;
    value: string;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
    placeholder?: string;
    leftSection?: React.ReactNode;
    autoFocus?: boolean;
  }) => (
    <label>
      {label}
      {leftSection}
      <input
        aria-label={String(label ?? placeholder)}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </label>
  );
  const UnstyledButton = ({
    children,
    selected,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    selected?: boolean;
  }) => {
    void selected;
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  };
  const Modal = ({
    opened,
    title,
    children,
    onClose,
    closeButtonProps,
  }: {
    opened: boolean;
    title?: React.ReactNode;
    children?: React.ReactNode;
    onClose: () => void;
    closeButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  }) =>
    opened ? (
      <div role="dialog">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} {...closeButtonProps} />
        {children}
      </div>
    ) : null;
  const Divider = ({ label }: { label?: React.ReactNode }) => (
    <div>{label}</div>
  );
  return {
    Alert: Wrapper,
    Badge: Wrapper,
    Button,
    Center: Wrapper,
    Divider,
    Group: Wrapper,
    Loader: () => <span role="status" />,
    Modal,
    ScrollArea: Wrapper,
    Stack: Wrapper,
    Text,
    TextInput,
    UnstyledButton,
  };
});

vi.mock("@tabler/icons-react", () => ({
  IconAlertCircle: () => null,
  IconArrowLeft: () => null,
  IconFile: () => null,
  IconFolder: () => null,
  IconRefresh: () => null,
  IconSearch: () => null,
  IconTemplate: () => null,
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: mocks.notify },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: string;
    description?: string;
    action?: React.ReactNode;
  }) => (
    <div>
      {title}
      {description}
      {action}
    </div>
  ),
}));

vi.mock("../services/page-template-api", () => ({
  createPageFromTemplate: mocks.create,
  discoverPageTemplates: mocks.discover,
  getPageTemplateDestinations: mocks.destinations,
  isCollaborationUnavailable: (error: any) =>
    error?.response?.data?.code === "collaboration_unavailable" ||
    error?.response?.status === 503,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("TemplateUseModal", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ page: { id: "created-page" } });
    mocks.destinations.mockResolvedValue({
      rootAllowed: false,
      items: [
        {
          id: "parent-1",
          slugId: "parent",
          title: "Current page",
          icon: null,
          parentPageId: null,
        },
      ],
      nextCursor: null,
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TemplateUseModal
          opened
          spaceId="space-1"
          defaultParentPageId="parent-1"
          onClose={mocks.onClose}
          onCreated={mocks.onCreated}
        />,
      );
    });
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("keeps unavailable templates visible and confirms before creating", async () => {
    mocks.discover.mockResolvedValue({
      items: [
        template({ id: "regular-1", title: "Meeting notes" }),
        template({
          id: "synced-1",
          title: "Linked plan",
          kind: "synced",
          publishedRevision: null,
          actions: { use: false },
        }),
      ],
      nextCursor: null,
      capabilities: {},
    });
    render();
    await settle();

    const options = Array.from(container?.querySelectorAll("button") ?? []);
    const unavailable = options.find((button) =>
      button.textContent?.includes("Linked plan"),
    );
    expect(unavailable?.disabled).toBe(false);
    expect(unavailable?.getAttribute("aria-disabled")).toBe("true");
    unavailable?.focus();
    expect(document.activeElement).toBe(unavailable);
    expect(unavailable?.textContent).toContain("Linked page");
    expect(unavailable?.textContent).toContain("Not published");

    const regular = options.find((button) =>
      button.textContent?.includes("Meeting notes"),
    );
    await act(async () => regular?.click());
    expect(mocks.create).not.toHaveBeenCalled();
    await settle();

    const parent = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("Current page"),
    );
    expect(parent?.getAttribute("aria-pressed")).toBe("true");

    const create = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Create page",
    );
    await act(async () => create?.click());
    await settle();

    expect(mocks.create).toHaveBeenCalledWith({
      templatePageId: "regular-1",
      spaceId: "space-1",
      parentPageId: "parent-1",
      title: "Meeting notes",
    });
    expect(mocks.onCreated).toHaveBeenCalledWith({ id: "created-page" });
  });

  it("preserves the use form and retries after collaboration is unavailable", async () => {
    mocks.discover.mockResolvedValue({
      items: [template()],
      nextCursor: null,
      capabilities: {},
    });
    mocks.create
      .mockRejectedValueOnce({
        response: {
          status: 503,
          data: { code: "collaboration_unavailable" },
        },
      })
      .mockResolvedValueOnce({ page: { id: "recovered-page" } });
    render();
    await settle();

    const templateButton = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Meeting notes"));
    await act(async () => templateButton?.click());
    await settle();

    const title = container?.querySelector(
      'input[aria-label="Page title"]',
    ) as HTMLInputElement | null;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(title, "Recovered page title");
      title?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      Array.from(container?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "Create page")
        ?.click(),
    );
    await settle();

    expect(container?.textContent).toContain(
      "Live editing is temporarily unavailable. Your input is preserved. Try again.",
    );
    expect(title?.value).toBe("Recovered page title");
    expect(
      Array.from(container?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent?.includes("Current page"))
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    await act(async () =>
      Array.from(container?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "Retry")
        ?.click(),
    );
    await settle();

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenLastCalledWith({
      templatePageId: "regular-1",
      spaceId: "space-1",
      parentPageId: "parent-1",
      title: "Recovered page title",
    });
    expect(mocks.onCreated).toHaveBeenCalledWith({ id: "recovered-page" });
  });

  it("fails closed when the default parent is no longer a destination", async () => {
    mocks.discover.mockResolvedValue({
      items: [template()],
      nextCursor: null,
      capabilities: {},
    });
    mocks.destinations.mockImplementation(
      async (params: { pageId?: string }) =>
        params.pageId
          ? { rootAllowed: false, items: [], nextCursor: null }
          : {
              rootAllowed: false,
              items: [
                {
                  id: "other-parent",
                  slugId: "other-parent",
                  title: "Other parent",
                  icon: null,
                  parentPageId: null,
                },
              ],
              nextCursor: null,
            },
    );
    render();
    await settle();

    const templateButton = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Meeting notes"));
    await act(async () => templateButton?.click());
    await settle();

    expect(mocks.destinations).toHaveBeenCalledWith({
      spaceId: "space-1",
      purpose: "destination",
      pageId: "parent-1",
      limit: 1,
    });
    const create = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Create page",
    );
    expect(create?.disabled).toBe(true);
  });

  it("shows a retry action after catalog loading fails", async () => {
    mocks.discover
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        items: [template()],
        nextCursor: null,
        capabilities: {},
      });
    render();
    await settle();

    const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => retry?.click());
    await settle();

    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("Meeting notes");
  });

  it("keeps pagination available when an ACL-filtered catalog page is empty", async () => {
    mocks.discover
      .mockResolvedValueOnce({
        items: [],
        nextCursor: "next-page",
        capabilities: {},
      })
      .mockResolvedValueOnce({
        items: [template()],
        nextCursor: null,
        capabilities: {},
      });
    render();
    await settle();

    const loadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    expect(loadMore).toBeDefined();
    await act(async () => loadMore?.click());
    await settle();

    expect(mocks.discover).toHaveBeenLastCalledWith({
      spaceId: "space-1",
      query: undefined,
      cursor: "next-page",
      limit: 20,
      archiveState: "active",
    });
    expect(container?.textContent).toContain("Meeting notes");
  });

  it("releases template pagination when a new search supersedes an append", async () => {
    let resolveAppend: (value: unknown) => void = () => undefined;
    mocks.discover
      .mockResolvedValueOnce({
        items: [template()],
        nextCursor: "append-page",
        capabilities: {},
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveAppend = resolve;
        }),
      )
      .mockResolvedValueOnce({
        items: [template({ id: "filtered", title: "Filtered template" })],
        nextCursor: "filtered-page",
        capabilities: {},
      });
    render();
    await settle();

    const firstLoadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    act(() => firstLoadMore?.click());
    const search = container?.querySelector(
      'input[aria-label="Search templates"]',
    ) as HTMLInputElement | null;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "filtered");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    const currentLoadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    expect(currentLoadMore?.disabled).toBe(false);
    expect(container?.textContent).toContain("Filtered template");

    await act(async () => {
      resolveAppend({ items: [], nextCursor: null, capabilities: {} });
      await Promise.resolve();
    });
  });

  it("releases destination pagination when a new search supersedes an append", async () => {
    let resolveAppend: (value: unknown) => void = () => undefined;
    mocks.discover.mockResolvedValue({
      items: [template()],
      nextCursor: null,
      capabilities: {},
    });
    mocks.destinations
      .mockResolvedValueOnce({
        rootAllowed: false,
        items: [
          {
            id: "parent-1",
            slugId: "parent",
            title: "Current page",
            icon: null,
            parentPageId: null,
          },
        ],
        nextCursor: "append-page",
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveAppend = resolve;
        }),
      )
      .mockResolvedValueOnce({
        rootAllowed: false,
        items: [
          {
            id: "filtered-parent",
            slugId: "filtered-parent",
            title: "Filtered parent",
            icon: null,
            parentPageId: null,
          },
        ],
        nextCursor: "filtered-page",
      });
    render();
    await settle();
    const templateButton = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Meeting notes"));
    act(() => templateButton?.click());
    await settle();

    const firstLoadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    act(() => firstLoadMore?.click());
    const search = container?.querySelector(
      'input[aria-label="Search parent pages"]',
    ) as HTMLInputElement | null;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "filtered");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    const currentLoadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    expect(currentLoadMore?.disabled).toBe(false);
    expect(container?.textContent).toContain("Filtered parent");

    await act(async () => {
      resolveAppend({ rootAllowed: false, items: [], nextCursor: null });
      await Promise.resolve();
    });
  });

  it("requires an explicit title before confirming an untitled template", async () => {
    mocks.discover.mockResolvedValue({
      items: [template({ title: null })],
      nextCursor: null,
      capabilities: {},
    });
    render();
    await settle();

    const untitled = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Untitled"));
    await act(async () => untitled?.click());
    await settle();

    const create = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Create page",
    );
    expect(create?.disabled).toBe(true);

    const title = container?.querySelector(
      'input[aria-label="Page title"]',
    ) as HTMLInputElement | null;
    act(() => {
      if (!title) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(title, "New page");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(create?.disabled).toBe(false);
  });

  it("keeps the modal open while page creation is in flight", async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    mocks.create.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    mocks.discover.mockResolvedValue({
      items: [template()],
      nextCursor: null,
      capabilities: {},
    });
    render();
    await settle();

    const templateButton = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Meeting notes"));
    await act(async () => templateButton?.click());
    await settle();
    const create = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Create page",
    );
    act(() => create?.click());

    const close = container?.querySelector(
      'button[aria-label="Close"]',
    ) as HTMLButtonElement | null;
    expect(close?.disabled).toBe(true);
    act(() => close?.click());
    expect(mocks.onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate({ page: { id: "created-page" } });
      await Promise.resolve();
    });
  });
});

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: "regular-1",
    slugId: "meeting-notes",
    title: "Meeting notes",
    icon: null,
    spaceId: "space-1",
    spaceName: "Team",
    spaceSlug: "team",
    kind: "regular",
    updatedAt: "2026-08-14T10:00:00.000Z",
    archivedAt: null,
    archiveState: "active",
    favorite: false,
    recent: true,
    publishedRevision: null,
    draftChanged: false,
    usageCount: 0,
    activeInstanceCount: 0,
    failedInstanceCount: 0,
    ...overrides,
    actions: {
      use: true,
      manage: false,
      archive: false,
      restore: false,
      ...((overrides.actions as Record<string, boolean> | undefined) ?? {}),
    },
  };
}
