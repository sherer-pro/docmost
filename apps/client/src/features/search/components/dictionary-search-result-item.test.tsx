// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DictionarySearchResultItem } from "./dictionary-search-result-item";

const closeSpotlight = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ to, ...props }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));

vi.mock("../constants", () => ({
  searchSpotlight: { close: closeSpotlight },
}));

vi.mock("@mantine/spotlight", () => ({
  Spotlight: {
    Action: ({ component: Component = "button", ...props }: any) => (
      <Component {...props} />
    ),
  },
}));

vi.mock("@mantine/core", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
  Box: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Group: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@tabler/icons-react", () => ({
  IconBook2: () => null,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("DictionarySearchResultItem", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = null;
    container = null;
    closeSpotlight.mockClear();
  });

  it("shows the definition and links the result directly to the term", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <DictionarySearchResultItem
          result={{
            id: "term-1",
            term: "Protocol",
            matchedField: "form",
            matchedForm: "Protocols",
            snippet: {
              text: "Protocols",
              matches: [{ start: 0, end: 9, value: "Protocols" }],
            },
            definitionSnippet: {
              text: "Safe definition",
              matches: [],
            },
            rank: 900,
            space: {
              id: "space-1",
              name: "Engineering",
              slug: "engineering",
              icon: null,
            },
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Safe definition");
    expect(container.querySelector("button")).toBeNull();
    const links = container.querySelectorAll<HTMLAnchorElement>("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      "/s/engineering/dictionary?term=term-1",
    );
    links[0]?.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });

    act(() => links[0]?.click());

    expect(closeSpotlight).toHaveBeenCalledOnce();
  });
});
