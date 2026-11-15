// @vitest-environment jsdom

import React, { act, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

const mocks = vi.hoisted(() => ({
  pageSlug: "first-page",
  query: vi.fn(),
  refetch: vi.fn(),
  editor: null as React.ComponentType | null,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router-dom", () => ({
  useParams: () => ({ pageSlug: mocks.pageSlug, spaceSlug: "docs" }),
  useLocation: () => ({ pathname: "/docs/first-page", state: null }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: any) => <a>{children}</a>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@mantine/core", () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
  Container: ({ children }: any) => <div>{children}</div>,
  Skeleton: () => null,
  Stack: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/empty-state.tsx", () => ({
  EmptyState: ({ title, action }: any) => (
    <div>
      {title}
      {action}
    </div>
  ),
}));
vi.mock("@/features/page/queries/page-query", () => ({
  usePageQuery: () => mocks.query(),
}));
vi.mock("@/features/comment/hooks/use-comment-deep-link", () => ({
  useCommentDeepLink: () => undefined,
}));
vi.mock("@/features/editor/full-editor", () => ({
  FullEditor: () => {
    const Editor = mocks.editor;
    return Editor ? <Editor /> : <p>Loaded page</p>;
  },
}));
vi.mock("react-helmet-async", () => ({ Helmet: () => null }));
vi.mock("@/features/page-history/components/history-modal", () => ({
  default: () => null,
}));
vi.mock("@/features/page/components/header/page-header.tsx", () => ({
  default: () => null,
}));
vi.mock(
  "@/features/page/components/document-fields/document-fields-panel.tsx",
  () => ({ default: () => null }),
);
vi.mock("@/features/page/components/template-editing-alert.tsx", () => ({
  TemplateEditingAlert: () => null,
}));
vi.mock("@/features/page/components/template-instance-alert.tsx", () => ({
  TemplateInstanceAlert: () => null,
}));
vi.mock("@/features/ai/components/deferred-ai-document-context-sync", () => ({
  DeferredAiDocumentContextSync: () => null,
}));
vi.mock("@/features/space/queries/space-query", () => ({
  useSpaceQuery: () => ({}),
}));
vi.mock("@/features/page-template/queries/page-template-query", () => ({
  usePageTemplateCapabilitiesQuery: () => ({}),
}));
vi.mock("@/features/page/utils/heading-numbering", () => ({
  resolveHeadingNumberingEnabled: () => false,
}));
vi.mock("@/lib", () => ({ extractPageSlugId: (value: string) => value }));
vi.mock("jotai", () => ({ useAtom: () => [{}, vi.fn()] }));
vi.mock("@/components/layouts/global/hooks/atoms/sidebar-atom.ts", () => ({
  asideStateAtom: {},
}));
vi.mock("@/features/user/atoms/current-user-atom.ts", () => ({ userAtom: {} }));

describe("page error recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.pageSlug = "first-page";
    mocks.editor = null;
    mocks.refetch.mockReset();
    mocks.query.mockReturnValue({
      data: { id: "page-id", title: "Page", access: { capabilities: {} } },
      refetch: mocks.refetch,
    });
    reload = vi.fn();
    const originalWindow = window;
    vi.stubGlobal(
      "window",
      new Proxy(originalWindow, {
        get(target, property) {
          return property === "location"
            ? { reload }
            : Reflect.get(target, property);
        },
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderPage() {
    await act(async () => {
      root.render(
        <Suspense fallback={null}>
          <Page />
        </Suspense>,
      );
    });
  }

  it("reloads the document when retrying a cached lazy module rejection", async () => {
    const loadEditor = vi
      .fn()
      .mockRejectedValue(
        new TypeError("Failed to fetch dynamically imported module"),
      );
    mocks.editor = lazy(loadEditor);

    await renderPage();
    expect(container.textContent).toContain(
      "Failed to load page. An error occurred.",
    );
    expect(loadEditor).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();

    // A healthy network cannot reset React.lazy's cached rejection.
    loadEditor.mockResolvedValue({ default: () => <p>Loaded page</p> });
    await act(async () => container.querySelector("button")!.click());

    expect(reload).toHaveBeenCalledOnce();
    expect(loadEditor).toHaveBeenCalledOnce();
  });

  it("reloads the document when retrying a render failure", async () => {
    mocks.editor = () => {
      throw new Error("Editor initialization failed");
    };
    await renderPage();
    expect(reload).not.toHaveBeenCalled();

    act(() => container.querySelector("button")!.click());

    expect(reload).toHaveBeenCalledOnce();
  });

  it("retries page data requests without reloading the document", async () => {
    mocks.query.mockReturnValue({ isError: true, refetch: mocks.refetch });
    await renderPage();
    expect(container.textContent).toContain("Error fetching page data.");

    act(() => container.querySelector("button")!.click());

    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears the page failure when navigating to another page", async () => {
    mocks.editor = () => {
      throw new Error("Editor initialization failed");
    };
    await renderPage();
    expect(container.textContent).toContain(
      "Failed to load page. An error occurred.",
    );

    mocks.editor = null;
    mocks.pageSlug = "second-page";
    await renderPage();

    expect(container.textContent).toContain("Loaded page");
    expect(reload).not.toHaveBeenCalled();
  });
});
