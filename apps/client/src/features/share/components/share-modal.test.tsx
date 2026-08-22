// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShareModal from "./share-modal";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  workspace: { settings: { sharing: { disabled: false } } } as any,
  space: { settings: { sharing: { disabled: false } } } as any,
  page: {
    id: "page-id",
    slugId: "page-slug-id",
    spaceId: "space-id",
    title: "Page",
    space: {
      slug: "space",
      settings: { sharing: { disabled: false } },
    },
  } as any,
  shareQueryArgs: undefined as any,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  Link: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
  useParams: () => ({ pageSlug: "page-slug-id", spaceSlug: "space" }),
}));

vi.mock("jotai", () => ({
  useAtom: () => [state.workspace],
}));

vi.mock("@/features/user/atoms/current-user-atom.ts", () => ({
  workspaceAtom: {},
}));

vi.mock("@/features/page/queries/page-query.ts", () => ({
  usePageQuery: () => ({ data: state.page }),
}));

vi.mock("@/features/space/queries/space-query.ts", () => ({
  useSpaceQuery: () => ({ data: state.space }),
}));

vi.mock("@/features/share/queries/share-query.ts", () => ({
  useShareForPageQuery: (args: unknown) => {
    state.shareQueryArgs = args;
    return { data: undefined };
  },
  useCreateShareMutation: () => ({ mutateAsync: vi.fn() }),
  useUpdateShareMutation: () => ({ mutateAsync: vi.fn() }),
  useDeleteShareMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/lib", () => ({
  extractPageSlugId: () => "page-id",
  getPageIcon: () => null,
}));

vi.mock("@/lib/config.ts", () => ({
  getAppUrl: () => "https://docmost.example",
}));

vi.mock("@/features/page/page.utils.ts", () => ({
  buildPageUrl: () => "/page",
  buildSharedPageUrl: () => "/share/page",
}));

vi.mock("@/components/common/copy.tsx", () => ({
  default: () => <button type="button">Copy</button>,
}));

vi.mock("@/components/ui/accessible-action-icon.tsx", () => ({
  AccessibleActionIcon: ({
    children,
    label,
  }: {
    children: React.ReactNode;
    label: string;
  }) => (
    <button type="button" aria-label={label}>
      {children}
    </button>
  ),
}));

vi.mock("@tabler/icons-react", () => ({
  IconExternalLink: () => null,
  IconWorld: () => <span aria-hidden="true">world</span>,
}));

vi.mock("@mantine/core", () => {
  const Container = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Popover = Object.assign(Container, {
    Target: Container,
    Dropdown: Container,
  });

  return {
    ActionIcon: ({
      children,
      "aria-label": ariaLabel,
    }: {
      children: React.ReactNode;
      "aria-label"?: string;
    }) => <button aria-label={ariaLabel}>{children}</button>,
    Anchor: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    Group: Container,
    Indicator: Container,
    Popover,
    Switch: ({
      checked,
      onChange,
      "aria-label": ariaLabel,
    }: {
      checked?: boolean;
      onChange?: React.ChangeEventHandler<HTMLInputElement>;
      "aria-label"?: string;
    }) => (
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
      />
    ),
    Text: Container,
    TextInput: ({ value }: { value?: string }) => (
      <input readOnly value={value} />
    ),
  };
});

function renderShareModal() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ShareModal />);
  });

  return { container, root };
}

describe("ShareModal policy visibility", () => {
  let mountedRoot: Root | null = null;
  let mountedContainer: HTMLElement | null = null;

  afterEach(() => {
    if (mountedRoot && mountedContainer) {
      act(() => mountedRoot?.unmount());
      mountedContainer.remove();
    }

    mountedRoot = null;
    mountedContainer = null;
    state.workspace = { settings: { sharing: { disabled: false } } };
    state.space = { settings: { sharing: { disabled: false } } };
    state.page.space.settings.sharing.disabled = false;
    state.shareQueryArgs = undefined;
  });

  it("hides the trigger when workspace sharing is disabled", () => {
    state.workspace.settings.sharing.disabled = true;
    const { container, root } = renderShareModal();
    mountedRoot = root;
    mountedContainer = container;

    expect(container.querySelector('[aria-label="Share"]')).toBeNull();
    expect(state.shareQueryArgs.enabled).toBe(false);
  });

  it("hides the trigger when space sharing is disabled", () => {
    state.space.settings.sharing.disabled = true;
    const { container, root } = renderShareModal();
    mountedRoot = root;
    mountedContainer = container;

    expect(container.querySelector('[aria-label="Share"]')).toBeNull();
    expect(state.shareQueryArgs.enabled).toBe(false);
  });

  it("uses the page space as a policy fallback", () => {
    state.space = undefined;
    state.page.space.settings.sharing.disabled = true;
    const { container, root } = renderShareModal();
    mountedRoot = root;
    mountedContainer = container;

    expect(container.querySelector('[aria-label="Share"]')).toBeNull();
  });

  it("shows the trigger when public sharing is allowed", () => {
    const { container, root } = renderShareModal();
    mountedRoot = root;
    mountedContainer = container;

    expect(container.querySelector('[aria-label="Share"]')).not.toBeNull();
    expect(state.shareQueryArgs.enabled).toBe(true);
  });
});
