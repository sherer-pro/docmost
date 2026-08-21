// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateInstanceAlert } from "./template-instance-alert";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refetch: vi.fn(),
  createIndependentPageCopy: vi.fn(),
  detach: vi.fn(),
  hash: vi.fn(),
  invalidateQueries: vi.fn(),
  invalidateSidebarTree: vi.fn(),
  buildPageUrl: vi.fn(),
  notify: vi.fn(),
  query: {} as Record<string, unknown>,
  editor: { getJSON: vi.fn(() => ({ type: "doc", content: [] })) },
}));

vi.mock("@mantine/core", () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Paper = ({
    children,
    component: Component = "section",
    ...props
  }: {
    children?: React.ReactNode;
    component?: React.ElementType;
    [key: string]: unknown;
  }) => {
    const { withBorder, radius, px, py, mb, ...domProps } = props;
    void withBorder;
    void radius;
    void px;
    void py;
    void mb;
    return <Component {...domProps}>{children}</Component>;
  };
  const Button = ({
    children,
    component: Component,
    leftSection,
    loading,
    size,
    variant,
    color,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    component?: React.ElementType;
    leftSection?: React.ReactNode;
    loading?: boolean;
    size?: string;
    variant?: string;
    color?: string;
    to?: string;
  }) => {
    void loading;
    void size;
    void variant;
    void color;
    if (Component) {
      return (
        <Component {...props}>
          {leftSection}
          {children}
        </Component>
      );
    }
    return (
      <button type="button" {...props}>
        {leftSection}
        {children}
      </button>
    );
  };
  const Checkbox = ({
    checked,
    onChange,
    label,
  }: {
    checked: boolean;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
    label: React.ReactNode;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={String(label)}
      />
      {label}
    </label>
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
  return {
    Badge: Wrapper,
    Button,
    Checkbox,
    Group: Wrapper,
    Modal,
    Paper,
    Skeleton: () => <div data-testid="skeleton" />,
    Stack: Wrapper,
    Text: Wrapper,
  };
});

vi.mock("@tabler/icons-react", () => ({
  IconAlertTriangle: () => null,
  IconCopy: () => null,
  IconExternalLink: () => null,
  IconLink: () => null,
  IconLinkOff: () => null,
  IconRefresh: () => null,
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: mocks.notify },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
        key,
      ),
  }),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock("jotai", () => ({ useAtomValue: () => mocks.editor }));

vi.mock("@/features/editor/atoms/editor-atoms", () => ({
  pageEditorAtom: {},
}));

vi.mock("@/features/page/queries/page-details-query", () => ({
  PAGE_DETAILS_QUERY_KEYS: {
    templateProvenance: (pageId: string) => ["provenance", pageId],
  },
  usePageTemplateProvenanceQuery: () => mocks.query,
}));

vi.mock("@/features/page-template/services/page-template-api", () => ({
  createIndependentPageCopy: mocks.createIndependentPageCopy,
  detachSyncedPageTemplate: mocks.detach,
}));

vi.mock("@/features/page-template/services/page-template-draft-hash", () => ({
  hashTemplateInstanceContent: mocks.hash,
}));

vi.mock("@/features/page/queries/cache-invalidation", () => ({
  invalidateSidebarTree: mocks.invalidateSidebarTree,
}));

vi.mock("@/features/page/page.utils", () => ({
  buildPageUrl: mocks.buildPageUrl,
}));

vi.mock("@/lib/query-client", () => ({
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("TemplateInstanceAlert", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hash.mockResolvedValue("content-hash");
    mocks.refetch.mockResolvedValue(undefined);
    mocks.buildPageUrl.mockImplementation(
      (_space: string, slug: string) => `/pages/${slug}`,
    );
    mocks.query = {
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: mocks.refetch,
    };
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(editable = true) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TemplateInstanceAlert pageId="page-1" editable={editable} />,
      );
    });
  }

  it("shows provenance failure as a recoverable status", async () => {
    mocks.query = {
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: mocks.refetch,
    };
    render();

    expect(container?.textContent).toContain(
      "Could not load template details.",
    );
    const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("Retry"),
    );
    await act(async () => retry?.click());
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("shows a missing source as recovery instead of up to date", async () => {
    mocks.query = {
      ...linkedQuery("active"),
      data: {
        ...linkedQuery("active").data,
        provenanceState: "source_missing",
        sourceTemplate: null,
        canReadTemplate: false,
        lastErrorCode: "page_template_source_missing",
      },
    };
    render();

    expect(container?.textContent).toContain(
      "The source template is no longer available.",
    );
    expect(container?.textContent).not.toContain("Up to date");
    const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("Retry"),
    );
    await act(async () => retry?.click());
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a restricted source privacy safe without showing recovery", () => {
    mocks.query = {
      ...linkedQuery("active"),
      data: {
        ...linkedQuery("active").data,
        provenanceState: "restricted",
        sourceTemplate: null,
        canReadTemplate: false,
      },
    };
    render();

    expect(container?.textContent).toContain(
      "The source template is restricted, but this page remains usable.",
    );
    expect(container?.textContent).toContain("Up to date");
    expect(container?.textContent).not.toContain("Project template");
    expect(container?.textContent).not.toContain("Retry");
  });

  it.each(["active", "syncing", "error"] as const)(
    "keeps detach available for %s linked instances",
    (status) => {
      mocks.query = linkedQuery(status);
      render();
      expect(container?.textContent).toContain("Detach");
    },
  );

  it("builds the source template link with its canonical space route", () => {
    mocks.query = linkedQuery("active");
    render();

    const link = Array.from(container?.querySelectorAll("a") ?? []).find(
      (candidate) => candidate.textContent?.includes("Open template"),
    );
    expect(link?.getAttribute("href")).toBe("/pages/template-slug");
    expect(mocks.buildPageUrl).toHaveBeenCalledWith(
      "space",
      "template-slug",
      "Project template",
    );
  });

  it("creates and opens an independent copy without detaching the source page", async () => {
    mocks.query = linkedQuery("active");
    mocks.createIndependentPageCopy.mockResolvedValue({
      page: {
        id: "copy-1",
        slugId: "copy-slug",
        title: "Independent",
        spaceId: "space-1",
        space: { slug: "space" },
      },
      idempotent: false,
    });
    render();

    const copy = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("Create independent copy"),
    );
    await act(async () => copy?.click());

    expect(mocks.createIndependentPageCopy).toHaveBeenCalledWith({
      pageId: "page-1",
    });
    expect(mocks.detach).not.toHaveBeenCalled();
    expect(mocks.invalidateSidebarTree).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/pages/copy-slug");
  });

  it("offers an allowed independent copy even when the source page is read only", () => {
    mocks.query = linkedQuery("active");
    render(false);

    expect(container?.textContent).toContain("Create independent copy");
    expect(container?.textContent).not.toContain("Detach");
  });
});

function linkedQuery(status: "active" | "syncing" | "error") {
  return {
    data: {
      createdFromTemplate: true,
      kind: "synced",
      status,
      provenanceState: "linked",
      appliedRevision: 2,
      latestRevision: 3,
      canReadTemplate: true,
      canDetach: true,
      canCreateIndependentCopy: true,
      lastErrorCode:
        status === "error" ? "page_template_operation_failed" : null,
      sourceTemplate: {
        id: "template-1",
        slugId: "template-slug",
        title: "Project template",
        icon: null,
        spaceSlug: "space",
      },
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
  };
}
