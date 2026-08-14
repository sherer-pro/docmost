// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageTemplateDiscoveryItem } from "@/features/page-template/types/page-template.types";
import SpaceTemplates, {
  CreateTemplateWizard,
  TemplateCatalogRow,
  TemplateDetailsDrawer,
} from "./space-templates";

const mocks = vi.hoisted(() => ({
  createTemplate: vi.fn(),
  destinations: vi.fn(),
  discover: vi.fn(),
  getPageById: vi.fn(),
  revisions: vi.fn(),
  runs: vi.fn(),
  usages: vi.fn(),
  notify: vi.fn(),
  capabilities: undefined as
    | {
        enabled: boolean;
        createTemplate: boolean;
        manageTemplate: boolean;
        useRegular: boolean;
        useSynced: boolean;
      }
    | undefined,
  space: undefined as { id: string; slug: string; name: string } | undefined,
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
  const Center = ({
    children,
    role,
  }: {
    children?: React.ReactNode;
    role?: string;
  }) => <div role={role}>{children}</div>;
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
    component: Component = "button",
    variant,
    color,
    size,
    ...props
  }: {
    children?: React.ReactNode;
    leftSection?: React.ReactNode;
    loading?: boolean;
    component?: React.ElementType;
    variant?: string;
    color?: string;
    size?: string;
    [key: string]: unknown;
  }) => {
    void variant;
    void color;
    void size;
    return (
      <Component
        type={Component === "button" ? "button" : undefined}
        {...props}
        disabled={Boolean(loading) || Boolean(props.disabled)}
      >
        {leftSection}
        {children}
      </Component>
    );
  };
  const TextInput = ({
    label,
    value,
    onChange,
    placeholder,
    leftSection,
    autoFocus,
    "aria-label": ariaLabel,
  }: {
    label?: React.ReactNode;
    value: string;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
    placeholder?: string;
    leftSection?: React.ReactNode;
    autoFocus?: boolean;
    "aria-label"?: string;
  }) => (
    <label>
      {label}
      {leftSection}
      <input
        aria-label={ariaLabel ?? String(label ?? placeholder)}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </label>
  );
  const UnstyledButton = ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  );
  const Modal = ({
    opened,
    title,
    children,
  }: {
    opened: boolean;
    title?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    opened ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null;
  const Drawer = ({
    opened,
    title,
    children,
  }: {
    opened: boolean;
    title?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    opened ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null;
  const SegmentedControl = ({
    value,
    onChange,
    data,
  }: {
    value: string;
    onChange: (value: string) => void;
    data: Array<{
      value: string;
      label: React.ReactNode;
      disabled?: boolean;
    }>;
  }) => (
    <div>
      {data.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          disabled={item.disabled}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
  const Menu = Object.assign(Wrapper, {
    Target: Wrapper,
    Dropdown: Wrapper,
    Item: Button,
  });
  const Tabs = Object.assign(Wrapper, {
    List: Wrapper,
    Tab: Wrapper,
    Panel: Wrapper,
  });
  return {
    Alert: Wrapper,
    Badge: Wrapper,
    Button,
    Center,
    Divider: ({ label }: { label?: React.ReactNode }) => <div>{label}</div>,
    Drawer,
    Group: Wrapper,
    Loader: () => <span data-testid="loader" />,
    Menu,
    Modal,
    Paper: Wrapper,
    ScrollArea: Wrapper,
    SegmentedControl,
    Select: () => null,
    SimpleGrid: Wrapper,
    Stack: Wrapper,
    Tabs,
    Text,
    TextInput,
    UnstyledButton,
  };
});

vi.mock("@mantine/notifications", () => ({
  notifications: { show: mocks.notify },
}));

vi.mock("@tabler/icons-react", () => ({
  IconAlertCircle: () => null,
  IconArchive: () => null,
  IconArchiveOff: () => null,
  IconChevronRight: () => null,
  IconDots: () => null,
  IconEdit: () => null,
  IconFile: () => null,
  IconFilePlus: () => null,
  IconFolder: () => null,
  IconHistory: () => null,
  IconLink: () => null,
  IconPlus: () => null,
  IconRefresh: () => null,
  IconSearch: () => null,
  IconTemplate: () => null,
  IconVersions: () => null,
}));

vi.mock("react-helmet-async", () => ({ Helmet: () => null }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: mocks.t,
    i18n: { language: "en-US" },
  }),
}));

vi.mock("react-router-dom", () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({ spaceSlug: "team" }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("@/components/ui/accessible-action-icon", () => ({
  AccessibleActionIcon: ({
    children,
    label,
  }: {
    children?: React.ReactNode;
    label: string;
  }) => (
    <button type="button" aria-label={label}>
      {children}
    </button>
  ),
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

vi.mock("@/components/ui/page-frame", () => ({
  PageFrame: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SectionHeader: () => null,
}));

vi.mock("@/features/page-template/components/page-template-picker", () => ({
  TemplateUseModal: () => null,
}));

vi.mock("@/features/page-template/services/page-template-api", () => ({
  archivePageTemplate: vi.fn(),
  createPageTemplate: mocks.createTemplate,
  discoverPageTemplates: mocks.discover,
  getPageTemplateDestinations: mocks.destinations,
  getPageTemplateRevisions: mocks.revisions,
  getPageTemplateSyncRuns: mocks.runs,
  getPageTemplateUsages: mocks.usages,
  restorePageTemplate: vi.fn(),
}));

vi.mock("@/features/page-template/queries/page-template-query", () => ({
  usePageTemplateCapabilitiesQuery: () => ({
    data: mocks.capabilities,
    isLoading: false,
    isError: false,
    isSuccess: Boolean(mocks.capabilities),
    refetch: vi.fn(),
  }),
}));

vi.mock("@/features/page/components/template-sync-status", () => ({
  getTemplateSyncErrorLabel: (value: string) => value,
  getTemplateSyncRunLabel: (value: string) => value,
}));

vi.mock("@/features/page/page.utils", () => ({
  buildPageUrl: () => "/page",
}));

vi.mock("@/features/page/queries/page-query", () => ({
  invalidateOnCreatePage: vi.fn(),
}));

vi.mock("@/features/page/services/page-service", () => ({
  getPageById: mocks.getPageById,
}));

vi.mock("@/features/space/queries/space-query", () => ({
  useGetSpaceBySlugQuery: () => ({ data: mocks.space }),
}));

vi.mock("@/lib/config", () => ({ getAppName: () => "Docmost" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("space template catalog components", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTemplate.mockResolvedValue({ page: { id: "template-page" } });
    mocks.capabilities = undefined;
    mocks.space = undefined;
    mocks.usages.mockResolvedValue({
      items: [],
      nextCursor: null,
      totalCount: 0,
      hiddenCount: 0,
    });
    mocks.revisions.mockResolvedValue({ items: [], nextCursor: null });
    mocks.runs.mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    act(() => root?.unmount());
    vi.useRealTimers();
    container?.remove();
    root = null;
    container = null;
  });

  function render(node: React.ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(node));
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("opens a row in the details drawer and skips revision calls for independent copies", async () => {
    let resolvePage: (page: Record<string, unknown>) => void = () => undefined;
    mocks.getPageById.mockReturnValue(
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
    );
    const item = template();

    function CatalogHarness() {
      const [selected, setSelected] =
        useState<PageTemplateDiscoveryItem | null>(null);
      return (
        <>
          <TemplateCatalogRow
            template={item}
            date="Aug 14, 2026"
            onOpen={() => setSelected(item)}
            onUse={vi.fn()}
            onArchive={vi.fn()}
            onRestore={vi.fn()}
          />
          <TemplateDetailsDrawer
            template={selected}
            opened={Boolean(selected)}
            mobile={false}
            dateFormatter={new Intl.DateTimeFormat("en-US")}
            onClose={vi.fn()}
            onUse={vi.fn()}
            onArchive={vi.fn()}
            onRestore={vi.fn()}
            templateUrl="/page/team/template"
            actionPending={false}
          />
        </>
      );
    }

    render(<CatalogHarness />);
    const row = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("Meeting notes"),
    );
    act(() => row?.click());

    expect(container?.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => {
      resolvePage({
        id: "regular-1",
        title: "Meeting notes",
        content:
          '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Agenda preview"}]}]}',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container?.textContent).toContain("Agenda preview");
    expect(container?.textContent).toContain("Independent copy");
    expect(container?.textContent).not.toContain("History");
    expect(mocks.revisions).not.toHaveBeenCalled();
    expect(mocks.runs).not.toHaveBeenCalled();
  });

  it("keeps preview available without requesting manage-only details", async () => {
    mocks.getPageById.mockResolvedValue({
      id: "regular-1",
      title: "Meeting notes",
      content:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Readable preview"}]}]}',
    });
    const item = template({
      actions: {
        use: true,
        manage: false,
        archive: false,
        restore: false,
      },
    });

    render(
      <TemplateDetailsDrawer
        template={item}
        opened
        mobile={false}
        dateFormatter={new Intl.DateTimeFormat("en-US")}
        onClose={vi.fn()}
        onUse={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        templateUrl="/page/team/template"
        actionPending={false}
      />,
    );
    await settle();

    expect(container?.textContent).toContain("Readable preview");
    expect(container?.textContent).toContain(
      "Usage and version details require permission to manage this template.",
    );
    expect(container?.textContent).not.toContain("Uses");
    expect(mocks.usages).not.toHaveBeenCalled();
    expect(mocks.revisions).not.toHaveBeenCalled();
    expect(mocks.runs).not.toHaveBeenCalled();
  });

  it("offers retry when details loading fails", async () => {
    mocks.getPageById
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        id: "regular-1",
        title: "Meeting notes",
        content:
          '{"type":"doc","content":[{"type":"paragraph","text":"Recovered preview"}]}',
      });

    render(
      <TemplateDetailsDrawer
        template={template()}
        opened
        mobile={false}
        dateFormatter={new Intl.DateTimeFormat("en-US")}
        onClose={vi.fn()}
        onUse={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        templateUrl="/page/team/template"
        actionPending={false}
      />,
    );
    await settle();

    expect(container?.textContent).toContain(
      "Could not load template history.",
    );
    const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => retry?.click());
    await settle();

    expect(mocks.getPageById).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("Recovered preview");
  });

  it("does not poll for a historical non-terminal run after the latest run finished", async () => {
    vi.useFakeTimers();
    mocks.getPageById.mockResolvedValue({
      id: "synced-1",
      title: "Linked plan",
      content: '{"type":"doc","content":[]}',
    });
    mocks.runs.mockResolvedValue({
      items: [
        syncRun({ id: "latest", status: "completed", revision: 3 }),
        syncRun({ id: "older", status: "running", revision: 2 }),
      ],
    });

    render(
      <TemplateDetailsDrawer
        template={template({
          id: "synced-1",
          kind: "synced",
          publishedRevision: 3,
        })}
        opened
        mobile={false}
        dateFormatter={new Intl.DateTimeFormat("en-US")}
        onClose={vi.fn()}
        onUse={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        templateUrl="/page/team/template"
        actionPending={false}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.runs).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(mocks.runs).toHaveBeenCalledTimes(1);
  });

  it("polls only sync runs while the latest run is non-terminal", async () => {
    vi.useFakeTimers();
    mocks.getPageById.mockResolvedValue({
      id: "synced-1",
      title: "Linked plan",
      content: '{"type":"doc","content":[]}',
    });
    mocks.runs
      .mockResolvedValueOnce({ items: [syncRun({ status: "running" })] })
      .mockResolvedValueOnce({ items: [syncRun({ status: "completed" })] });

    render(
      <TemplateDetailsDrawer
        template={template({ id: "synced-1", kind: "synced" })}
        opened
        mobile={false}
        dateFormatter={new Intl.DateTimeFormat("en-US")}
        onClose={vi.fn()}
        onUse={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        templateUrl="/page/team/template"
        actionPending={false}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.getPageById).toHaveBeenCalledTimes(1);
    expect(mocks.usages).toHaveBeenCalledTimes(1);
    expect(mocks.revisions).toHaveBeenCalledTimes(1);
    expect(mocks.runs).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(mocks.runs).toHaveBeenCalledTimes(2);
    expect(mocks.getPageById).toHaveBeenCalledTimes(1);
    expect(mocks.usages).toHaveBeenCalledTimes(1);
    expect(mocks.revisions).toHaveBeenCalledTimes(1);
  });

  it("ignores a late details response from the previously selected template", async () => {
    let resolveFirst: (page: Record<string, unknown>) => void = () => undefined;
    mocks.getPageById.mockImplementation(({ pageId }: { pageId: string }) => {
      if (pageId !== "first") {
        return Promise.resolve({
          id: "second",
          title: "Second",
          content:
            '{"type":"doc","content":[{"type":"paragraph","text":"second"}]}',
        });
      }
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    });

    const props = {
      opened: true,
      mobile: false,
      dateFormatter: new Intl.DateTimeFormat("en-US"),
      onClose: vi.fn(),
      onUse: vi.fn(),
      onArchive: vi.fn(),
      onRestore: vi.fn(),
      templateUrl: "/page/team/template",
      actionPending: false,
    };
    render(
      <TemplateDetailsDrawer
        {...props}
        template={template({ id: "first", title: "First" })}
      />,
    );
    act(() => {
      root?.render(
        <TemplateDetailsDrawer
          {...props}
          template={template({ id: "second", title: "Second" })}
        />,
      );
    });
    await settle();
    expect(container?.textContent).toContain("second");

    await act(async () => {
      resolveFirst({
        id: "first",
        title: "First",
        content:
          '{"type":"doc","content":[{"type":"paragraph","text":"first"}]}',
      });
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("second");
    expect(container?.textContent).not.toContain("first");
  });

  it("keeps usage pagination reachable after an empty ACL window", async () => {
    mocks.getPageById.mockResolvedValue({
      id: "regular-1",
      title: "Meeting notes",
      content: '{"type":"doc","content":[]}',
    });
    mocks.usages
      .mockResolvedValueOnce({
        items: [],
        nextCursor: "usage-page-2",
        totalCount: 2,
        hiddenCount: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            childPageId: "child-2",
            slugId: "child-2",
            title: "Readable page",
            icon: null,
            status: "snapshot",
            appliedRevision: null,
            lastErrorCode: null,
            updatedAt: "2026-08-14T10:00:00.000Z",
          },
        ],
        nextCursor: null,
        totalCount: 2,
        hiddenCount: 1,
      });

    render(
      <TemplateDetailsDrawer
        template={template()}
        opened
        mobile={false}
        dateFormatter={new Intl.DateTimeFormat("en-US")}
        onClose={vi.fn()}
        onUse={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        templateUrl="/page/team/template"
        actionPending={false}
      />,
    );
    await settle();
    const loadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    expect(loadMore).toBeDefined();
    await act(async () => loadMore?.click());
    await settle();

    expect(mocks.usages).toHaveBeenLastCalledWith(
      "regular-1",
      "usage-page-2",
      20,
    );
    expect(container?.textContent).toContain("Readable page");
  });

  it("ignores stale pagination after reopening the same template", async () => {
    let resolveStalePage: (value: unknown) => void = () => undefined;
    mocks.getPageById.mockResolvedValue({
      id: "regular-1",
      title: "Meeting notes",
      content: '{"type":"doc","content":[]}',
    });
    mocks.usages
      .mockResolvedValueOnce({
        items: [],
        nextCursor: "stale-cursor",
        totalCount: 1,
        hiddenCount: 0,
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStalePage = resolve;
        }),
      )
      .mockResolvedValueOnce({
        items: [
          {
            childPageId: "fresh-page",
            slugId: "fresh-page",
            title: "Fresh page",
            icon: null,
            status: "snapshot",
            appliedRevision: null,
            lastErrorCode: null,
            updatedAt: "2026-08-14T10:00:00.000Z",
          },
        ],
        nextCursor: null,
        totalCount: 1,
        hiddenCount: 0,
      });
    const props = {
      template: template(),
      mobile: false,
      dateFormatter: new Intl.DateTimeFormat("en-US"),
      onClose: vi.fn(),
      onUse: vi.fn(),
      onArchive: vi.fn(),
      onRestore: vi.fn(),
      templateUrl: "/page/team/template",
      actionPending: false,
    };

    render(<TemplateDetailsDrawer {...props} opened />);
    await settle();
    const loadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    act(() => loadMore?.click());
    act(() =>
      root?.render(<TemplateDetailsDrawer {...props} opened={false} />),
    );
    act(() => root?.render(<TemplateDetailsDrawer {...props} opened />));
    await settle();
    expect(container?.textContent).toContain("Fresh page");

    await act(async () => {
      resolveStalePage({
        items: [
          {
            childPageId: "stale-page",
            slugId: "stale-page",
            title: "Stale page",
            icon: null,
            status: "snapshot",
            appliedRevision: null,
            lastErrorCode: null,
            updatedAt: "2026-08-14T09:00:00.000Z",
          },
        ],
        nextCursor: null,
        totalCount: 1,
        hiddenCount: 0,
      });
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Fresh page");
    expect(container?.textContent).not.toContain("Stale page");
  });

  it("ignores stale revision pagination after reopening the same template", async () => {
    let resolveStalePage: (value: unknown) => void = () => undefined;
    mocks.getPageById.mockResolvedValue({
      id: "synced-1",
      title: "Linked plan",
      content: '{"type":"doc","content":[]}',
    });
    mocks.revisions
      .mockResolvedValueOnce({
        items: [],
        nextCursor: "stale-cursor",
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStalePage = resolve;
        }),
      )
      .mockResolvedValueOnce({
        items: [
          {
            id: "fresh-revision",
            templatePageId: "synced-1",
            revision: 42,
            contentHash: "fresh-hash",
            publishedById: "user-1",
            createdAt: "2026-08-14T10:00:00.000Z",
          },
        ],
        nextCursor: null,
      });
    const props = {
      template: template({
        id: "synced-1",
        kind: "synced" as const,
        title: "Linked plan",
      }),
      mobile: false,
      dateFormatter: new Intl.DateTimeFormat("en-US"),
      onClose: vi.fn(),
      onUse: vi.fn(),
      onArchive: vi.fn(),
      onRestore: vi.fn(),
      templateUrl: "/page/team/template",
      actionPending: false,
    };

    render(<TemplateDetailsDrawer {...props} opened />);
    await settle();
    const loadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    act(() => loadMore?.click());
    act(() =>
      root?.render(<TemplateDetailsDrawer {...props} opened={false} />),
    );
    act(() => root?.render(<TemplateDetailsDrawer {...props} opened />));
    await settle();
    expect(container?.textContent).toContain("Version 42");

    await act(async () => {
      resolveStalePage({
        items: [
          {
            id: "stale-revision",
            templatePageId: "synced-1",
            revision: 41,
            contentHash: "stale-hash",
            publishedById: "user-1",
            createdAt: "2026-08-14T09:00:00.000Z",
          },
        ],
        nextCursor: null,
      });
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Version 42");
    expect(container?.textContent).not.toContain("Version 41");
  });

  it("keeps catalog pagination reachable when an ACL-filtered page is empty", async () => {
    mocks.space = { id: "space-1", slug: "team", name: "Team" };
    mocks.capabilities = {
      enabled: true,
      createTemplate: true,
      manageTemplate: true,
      useRegular: true,
      useSynced: true,
    };
    mocks.discover
      .mockResolvedValueOnce({
        items: [],
        nextCursor: "next-page",
        capabilities: mocks.capabilities,
      })
      .mockResolvedValueOnce({
        items: [template()],
        nextCursor: null,
        capabilities: mocks.capabilities,
      });

    render(<SpaceTemplates />);
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
      kind: undefined,
      archiveState: "active",
      cursor: "next-page",
      limit: 20,
    });
    expect(container?.textContent).toContain("Meeting notes");
  });

  it("releases catalog pagination when a new search supersedes an append", async () => {
    mocks.space = { id: "space-1", slug: "team", name: "Team" };
    mocks.capabilities = {
      enabled: true,
      createTemplate: true,
      manageTemplate: true,
      useRegular: true,
      useSynced: true,
    };
    let resolveAppend: (value: unknown) => void = () => undefined;
    mocks.discover
      .mockResolvedValueOnce({
        items: [template()],
        nextCursor: "append-page",
        capabilities: mocks.capabilities,
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveAppend = resolve;
        }),
      )
      .mockResolvedValueOnce({
        items: [template({ id: "filtered", title: "Filtered template" })],
        nextCursor: "filtered-page",
        capabilities: mocks.capabilities,
      });

    render(<SpaceTemplates />);
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
      resolveAppend({
        items: [template({ id: "stale", title: "Stale template" })],
        nextCursor: null,
        capabilities: mocks.capabilities,
      });
      await Promise.resolve();
    });
    expect(container?.textContent).not.toContain("Stale template");
  });

  it("keeps the two-step wizard independent by default", async () => {
    const onCreated = vi.fn();
    render(
      <CreateTemplateWizard
        opened
        spaceId="space-1"
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );

    expect(mocks.destinations).not.toHaveBeenCalled();
    const name = container?.querySelector(
      'input[aria-label="Template name"]',
    ) as HTMLInputElement | null;
    act(() => {
      if (!name) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(name, "Meeting template");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const next = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Next",
    );
    act(() => next?.click());

    const independent = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Independent copy"));
    expect(independent?.getAttribute("aria-pressed")).toBe("true");
    expect(mocks.createTemplate).not.toHaveBeenCalled();

    const create = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Create template",
    );
    await act(async () => create?.click());
    await settle();

    expect(mocks.createTemplate).toHaveBeenCalledWith({
      spaceId: "space-1",
      kind: "regular",
      sourcePageId: undefined,
      title: "Meeting template",
    });
    expect(onCreated).toHaveBeenCalledWith({ id: "template-page" });
  });

  it("shows source loading, error, and retry with source-purpose discovery", async () => {
    let rejectSources: (error: Error) => void = () => undefined;
    mocks.destinations
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectSources = reject;
        }),
      )
      .mockResolvedValueOnce({
        rootAllowed: false,
        items: [],
        nextCursor: "source-page-2",
      })
      .mockResolvedValueOnce({
        rootAllowed: false,
        items: [
          {
            id: "source-1",
            slugId: "source",
            title: "Source page",
            icon: null,
            parentPageId: null,
          },
        ],
        nextCursor: null,
      });

    render(
      <CreateTemplateWizard
        opened
        spaceId="space-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    const existing = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Use an existing page");
    act(() => existing?.click());

    expect(container?.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => {
      rejectSources(new Error("offline"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container?.textContent).toContain("Could not load source pages");

    const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => retry?.click());
    await settle();

    expect(mocks.destinations).toHaveBeenNthCalledWith(2, {
      spaceId: "space-1",
      query: undefined,
      cursor: undefined,
      limit: 20,
      purpose: "source",
    });

    const loadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    expect(loadMore).toBeDefined();
    await act(async () => loadMore?.click());
    await settle();

    expect(mocks.destinations).toHaveBeenLastCalledWith({
      spaceId: "space-1",
      query: undefined,
      cursor: "source-page-2",
      limit: 20,
      purpose: "source",
    });
    expect(container?.textContent).toContain("Source page");
  });

  it("releases source pagination when a new search supersedes an append", async () => {
    let resolveAppend: (value: unknown) => void = () => undefined;
    mocks.destinations
      .mockResolvedValueOnce({
        rootAllowed: false,
        items: [
          {
            id: "source-1",
            slugId: "source",
            title: "Source page",
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
            id: "filtered-source",
            slugId: "filtered-source",
            title: "Filtered source",
            icon: null,
            parentPageId: null,
          },
        ],
        nextCursor: "filtered-page",
      });

    render(
      <CreateTemplateWizard
        opened
        spaceId="space-1"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    const existing = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Use an existing page");
    act(() => existing?.click());
    await settle();

    const firstLoadMore = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent === "Load more");
    act(() => firstLoadMore?.click());
    const search = container?.querySelector(
      'input[aria-label="Search pages"]',
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
    expect(container?.textContent).toContain("Filtered source");

    await act(async () => {
      resolveAppend({
        rootAllowed: false,
        items: [],
        nextCursor: null,
      });
      await Promise.resolve();
    });
  });

  it("fails closed when the preselected source is unavailable", async () => {
    mocks.destinations.mockResolvedValue({
      rootAllowed: false,
      items: [],
      nextCursor: null,
    });
    mocks.getPageById.mockRejectedValue(new Error("forbidden"));

    render(
      <CreateTemplateWizard
        opened
        spaceId="space-1"
        initialSourcePageId="missing-source"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    await settle();

    expect(container?.textContent).toContain(
      "The selected source page is no longer available or readable.",
    );
    const next = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Next",
    );
    expect(next?.disabled).toBe(true);
    expect(mocks.destinations).toHaveBeenCalledWith({
      spaceId: "space-1",
      purpose: "source",
      pageId: "missing-source",
      limit: 1,
    });
  });

  it("clears an unavailable initial source after a valid manual selection", async () => {
    mocks.destinations.mockImplementation(
      async (params: { pageId?: string }) =>
        params.pageId
          ? { rootAllowed: false, items: [], nextCursor: null }
          : {
              rootAllowed: false,
              items: [
                {
                  id: "replacement-source",
                  slugId: "replacement-source",
                  title: "Replacement source",
                  icon: null,
                  parentPageId: null,
                },
              ],
              nextCursor: null,
            },
    );

    render(
      <CreateTemplateWizard
        opened
        spaceId="space-1"
        initialSourcePageId="missing-source"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    await settle();

    const replacement = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Replacement source"));
    act(() => replacement?.click());

    expect(container?.textContent).not.toContain(
      "The selected source page is no longer available or readable.",
    );
    const next = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Next",
    );
    expect(next?.disabled).toBe(false);
  });

  it("keeps a manual source selected when search reloads the list", async () => {
    mocks.destinations.mockImplementation(
      async (params: { pageId?: string; query?: string }) => {
        if (params.pageId) {
          return {
            rootAllowed: false,
            items: [
              {
                id: "initial-source",
                slugId: "initial-source",
                title: "Initial source",
                icon: null,
                parentPageId: null,
              },
            ],
            nextCursor: null,
          };
        }
        return {
          rootAllowed: false,
          items: params.query
            ? [
                {
                  id: "filtered-source",
                  slugId: "filtered-source",
                  title: "Filtered source",
                  icon: null,
                  parentPageId: null,
                },
              ]
            : [
                {
                  id: "initial-source",
                  slugId: "initial-source",
                  title: "Initial source",
                  icon: null,
                  parentPageId: null,
                },
                {
                  id: "manual-source",
                  slugId: "manual-source",
                  title: "Manual source",
                  icon: null,
                  parentPageId: null,
                },
              ],
          nextCursor: null,
        };
      },
    );

    render(
      <CreateTemplateWizard
        opened
        spaceId="space-1"
        initialSourcePageId="initial-source"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    await settle();

    const manual = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("Manual source"),
    );
    act(() => manual?.click());
    const search = container?.querySelector(
      'input[aria-label="Search pages"]',
    ) as HTMLInputElement | null;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "filtered");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    const selected = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Manual source"));
    expect(selected?.getAttribute("aria-pressed")).toBe("true");
    expect(
      mocks.destinations.mock.calls.filter(
        ([params]) => params.pageId === "initial-source",
      ),
    ).toHaveLength(1);
  });

  it("preselects a menu source only after canonical eligibility succeeds", async () => {
    mocks.destinations.mockImplementation(
      async (params: { pageId?: string }) =>
        params.pageId
          ? {
              rootAllowed: false,
              items: [
                {
                  id: params.pageId,
                  slugId: "source",
                  title: "Eligible source",
                  icon: null,
                  parentPageId: null,
                },
              ],
              nextCursor: null,
            }
          : { rootAllowed: false, items: [], nextCursor: null },
    );

    render(
      <CreateTemplateWizard
        opened
        spaceId="space-1"
        initialSourcePageId="11111111-1111-1111-1111-111111111111"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    await settle();

    expect(container?.textContent).toContain("Eligible source");
    const next = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Next",
    );
    expect(next?.disabled).toBe(false);
    expect(mocks.destinations).toHaveBeenCalledWith({
      spaceId: "space-1",
      purpose: "source",
      pageId: "11111111-1111-1111-1111-111111111111",
      limit: 1,
    });
  });
});

function template(
  overrides: Partial<PageTemplateDiscoveryItem> = {},
): PageTemplateDiscoveryItem {
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
    actions: {
      use: true,
      manage: true,
      archive: true,
      restore: false,
    },
    ...overrides,
  };
}

function syncRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    templatePageId: "synced-1",
    revision: 1,
    status: "completed",
    totalCount: 1,
    processedCount: 1,
    succeededCount: 1,
    failedCount: 0,
    errorCode: null,
    startedAt: "2026-08-14T10:00:00.000Z",
    completedAt: "2026-08-14T10:01:00.000Z",
    createdAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  };
}
