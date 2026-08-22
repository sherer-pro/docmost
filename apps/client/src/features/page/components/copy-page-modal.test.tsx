// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import CopyPageModal from "./copy-page-modal";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  duplicatePage: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/features/page/services/page-service.ts", () => ({
  duplicatePage: mocks.duplicatePage,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

vi.mock("@/lib/query-client.ts", () => ({
  queryClient: { removeQueries: vi.fn() },
}));

vi.mock("@/features/page/page.utils.ts", () => ({
  buildDatabaseUrl: () => "/copied-database",
  buildPageUrl: () => "/copied-page",
}));

vi.mock("@/features/space/components/sidebar/space-select.tsx", () => ({
  SpaceSelect: ({ onChange }: { onChange: (space: any) => void }) => (
    <button
      type="button"
      onClick={() => onChange({ id: "space-2", slug: "target" })}
    >
      Select target
    </button>
  ),
}));

vi.mock("@mantine/core", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Root = ({
    children,
    opened,
  }: {
    children?: React.ReactNode;
    opened: boolean;
  }) => (opened ? <div>{children}</div> : null);

  return {
    Button: ({
      children,
      disabled,
      loading,
      onClick,
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      loading?: boolean;
      onClick?: () => void;
    }) => (
      <button type="button" disabled={disabled || loading} onClick={onClick}>
        {children}
      </button>
    ),
    Group: Container,
    Text: Container,
    Modal: {
      Root,
      Overlay: Container,
      Content: Container,
      Header: Container,
      Title: Container,
      CloseButton: ({ disabled }: { disabled?: boolean }) => (
        <button type="button" disabled={disabled} aria-label="Close" />
      ),
      Body: Container,
    },
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("CopyPageModal", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it("keeps rapid duplicate clicks behind one request", async () => {
    const copy = deferred<any>();
    mocks.duplicatePage.mockReturnValue(copy.promise);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <CopyPageModal
          pageId="page-1"
          currentSpaceSlug="source"
          open
          onClose={vi.fn()}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    act(() =>
      buttons.find((button) => button.textContent === "Select target")?.click(),
    );
    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Copy",
    );

    act(() => {
      copyButton?.click();
      copyButton?.click();
    });
    expect(mocks.duplicatePage).toHaveBeenCalledTimes(1);

    await act(async () => {
      copy.resolve({
        id: "copy-1",
        slugId: "copy-slug",
        title: "Copy",
        databaseId: null,
        space: { slug: "target" },
      });
      await copy.promise;
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/copied-page");
  });
});
