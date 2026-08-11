// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseCellRenderer } from "./database-cell-renderer";
import type { IDatabaseProperty } from "@/features/database/types/database.types";
import type { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/features/dictionary/components/dictionary-text-highlighter", () => ({
  DictionaryTextHighlighter: ({ text }: { text: string }) => (
    <span className="dictionary-highlight">{text}</span>
  ),
}));

vi.mock("@/features/dictionary/components/dictionary-textarea", () => ({
  DictionaryTextarea: () => null,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const term: IDictionaryTerm = {
  id: "term-1",
  workspaceId: "workspace-1",
  spaceId: "space-1",
  term: "Alpha",
  forms: [],
  definitionMarkdown: "Definition",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

const property: IDatabaseProperty = {
  id: "property-1",
  databaseId: "database-1",
  workspaceId: "workspace-1",
  name: "Code",
  type: "code",
  position: 0,
  settings: {},
  creatorId: "user-1",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  deletedAt: null,
};

describe("DatabaseCellRenderer dictionary exclusions", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("does not highlight dictionary terms in code properties", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <MantineProvider>
          <DatabaseCellRenderer
            property={property}
            value="Alpha"
            isEditable={false}
            isEditing={false}
            editingValue={null}
            spaceId="space-1"
            dictionaryTerms={[term]}
            dictionaryEnabled
            onStartEdit={vi.fn()}
            onChange={vi.fn()}
            onSave={vi.fn()}
          />
        </MantineProvider>,
      );
    });

    expect(container.textContent).toContain("Alpha");
    expect(container.querySelector(".dictionary-highlight")).toBeNull();
  });
});
