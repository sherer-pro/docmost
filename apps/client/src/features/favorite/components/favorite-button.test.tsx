// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import FavoriteButton from "./favorite-button";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const favoriteMocks = vi.hoisted(() => ({
  useFavoriteIdsQuery: vi.fn(),
  useToggleFavoriteMutation: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("@/features/favorite/queries/favorite-query", () => ({
  useFavoriteIdsQuery: favoriteMocks.useFavoriteIdsQuery,
  useToggleFavoriteMutation: favoriteMocks.useToggleFavoriteMutation,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("@tabler/icons-react", () => ({
  IconStar: ({ fill }: { fill?: string }) => (
    <span data-testid="favorite-star" data-fill={fill} />
  ),
}));

vi.mock("@mantine/core", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  ActionIcon: ({
    children,
    loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
  }) => (
    <button type="button" data-loading={loading || undefined} {...props}>
      {children}
    </button>
  ),
  Loader: () => <span data-testid="favorite-loader" />,
  Menu: {
    Item: ({
      children,
      leftSection,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      leftSection?: React.ReactNode;
    }) => (
      <button type="button" {...props}>
        {leftSection}
        {children}
      </button>
    ),
  },
}));

describe("FavoriteButton", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    favoriteMocks.mutate.mockReset();
    favoriteMocks.useFavoriteIdsQuery.mockReturnValue({
      data: { items: [] },
    });
    favoriteMocks.useToggleFavoriteMutation.mockReturnValue({
      isPending: false,
      mutate: favoriteMocks.mutate,
    });
  });

  afterEach(() => {
    favoriteMocks.useFavoriteIdsQuery.mockReset();
    favoriteMocks.useToggleFavoriteMutation.mockReset();

    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }

    root = null;
    container = null;
  });

  function renderFavorite(
    presentation: "action-icon" | "menu-item" = "action-icon",
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <FavoriteButton
          type="page"
          id="page-1"
          spaceId="space-1"
          presentation={presentation}
        />,
      );
    });

    return container;
  }

  it("toggles a page favorite from the action icon", () => {
    const view = renderFavorite();
    const button = view.querySelector("button");

    expect(button?.getAttribute("aria-label")).toBe("Add to favorites");
    expect(button?.dataset.pageHeaderAction).toBe("favorite");

    act(() => button?.click());

    expect(favoriteMocks.mutate).toHaveBeenCalledWith({
      type: "page",
      id: "page-1",
      isFavorite: false,
      spaceId: "space-1",
    });
  });

  it("renders the current favorite state as a menu item", () => {
    favoriteMocks.useFavoriteIdsQuery.mockReturnValue({
      data: { items: ["page-1"] },
    });
    const view = renderFavorite("menu-item");
    const button = view.querySelector("button");

    expect(button?.textContent).toContain("Remove from favorites");
    expect(button?.dataset.pageHeaderMenuAction).toBe("favorite");
    expect(
      view
        .querySelector('[data-testid="favorite-star"]')
        ?.getAttribute("data-fill"),
    ).toBe("currentColor");

    act(() => button?.click());

    expect(favoriteMocks.mutate).toHaveBeenCalledWith({
      type: "page",
      id: "page-1",
      isFavorite: true,
      spaceId: "space-1",
    });
  });

  it("disables the menu item and shows progress while updating", () => {
    favoriteMocks.useToggleFavoriteMutation.mockReturnValue({
      isPending: true,
      mutate: favoriteMocks.mutate,
    });
    const view = renderFavorite("menu-item");
    const button = view.querySelector("button");

    expect(button?.hasAttribute("disabled")).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(
      view.querySelector('[data-testid="favorite-loader"]'),
    ).not.toBeNull();
  });
});
