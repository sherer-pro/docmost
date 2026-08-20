// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DictionarySearchResultItem } from "./dictionary-search-result-item";

const termQuery = vi.hoisted(() =>
  vi.fn((_termId: string, enabled: boolean) => ({
    isLoading: false,
    isError: false,
    data: enabled
      ? {
          id: "term-1",
          term: "Protocol",
          forms: ["Protocols"],
          definitionMarkdown: "Safe definition",
        }
      : undefined,
  })),
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("@/features/dictionary/queries/dictionary-query", () => ({
  useDictionaryTermQuery: termQuery,
}));

vi.mock("@/features/dictionary/components/dictionary-markdown", () => ({
  DictionaryMarkdown: ({ markdown }: { markdown: string }) => (
    <div data-testid="definition">{markdown}</div>
  ),
}));

vi.mock("../constants", () => ({
  searchSpotlight: { close: vi.fn() },
}));

vi.mock("@mantine/spotlight", () => ({
  Spotlight: {
    Action: ({ children, ...props }: React.ComponentProps<"button">) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  },
}));

vi.mock("@mantine/core", () => ({
  ActionIcon: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  Badge: ({ children }: any) => <span>{children}</span>,
  Box: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Collapse: ({ children, in: opened }: any) =>
    opened ? <div>{children}</div> : null,
  Group: ({ children }: any) => <div>{children}</div>,
  Loader: () => <span>Loading</span>,
  Text: ({ children }: any) => <span>{children}</span>,
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock("@tabler/icons-react", () => ({
  IconBook2: () => null,
  IconChevronDown: () => null,
  IconExternalLink: () => null,
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
    termQuery.mockClear();
  });

  it("uses a keyboard-native disclosure and lazily loads the full term", () => {
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

    const disclosure = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false");
    expect(termQuery).toHaveBeenLastCalledWith("term-1", false);

    act(() => disclosure?.click());

    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
    expect(termQuery).toHaveBeenLastCalledWith("term-1", true);
    expect(
      container.querySelector("[data-testid='definition']")?.textContent,
    ).toBe("Safe definition");
    expect(
      container.querySelector<HTMLAnchorElement>("a")?.getAttribute("href"),
    ).toBe("/s/engineering/dictionary?term=term-1");
  });
});
