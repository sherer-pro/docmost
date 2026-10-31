// @vitest-environment jsdom

import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "jotai";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import SearchAndReplaceDialog from "./search-and-replace-dialog";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));
vi.mock("@mantine/core", () => {
  const Control = () => null;
  return {
    ActionIcon: Object.assign(Control, { Group: Control }),
    Button: Control,
    Dialog: Control,
    Flex: Control,
    Input: Control,
    Stack: Control,
    Text: Control,
    Tooltip: Control,
  };
});

function editorFixture() {
  const editor = {
    isDestroyed: false,
    storage: { searchAndReplace: { results: [], resultIndex: 0 } } as any,
    state: {
      doc: { textBetween: () => "Selected text" },
      selection: { from: 0, to: 13 },
    },
    commands: {} as Record<string, ReturnType<typeof vi.fn>>,
  };
  for (const name of [
    "setSearchTerm",
    "resetIndex",
    "selectCurrentItem",
    "setCaseSensitive",
    "setTextSelection",
  ]) {
    editor.commands[name] = vi.fn(() => {
      if (editor.isDestroyed) throw new Error("Destroyed editor command");
    });
  }
  return editor;
}

let root: Root;
let container: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

function mount(children: React.ReactNode) {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
  }
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <Provider>{children}</Provider>
      </MemoryRouter>,
    ),
  );
}

describe("search dialog editor lifecycle", () => {
  it("reapplies the URL term when the editor is replaced while the local input is unchanged", () => {
    const previous = editorFixture();
    const next = editorFixture();
    for (const editor of [previous, next])
      editor.commands.setSearchTerm.mockImplementation((term) => {
        editor.storage.searchAndReplace.searchTerm = term;
      });
    const render = (editor: typeof previous) => (
      <MemoryRouter initialEntries={["/p/page?find=note"]}>
        <Provider>
          <SearchAndReplaceDialog editor={editor as any} />
        </Provider>
      </MemoryRouter>
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(render(previous)));
    expect(previous.storage.searchAndReplace.searchTerm).toBe("note");
    act(() => root.render(render(next)));
    expect(next.storage.searchAndReplace.searchTerm).toBe("note");
  });
  it("initializes a literal search from a result link for a read-only editor", () => {
    const editor = editorFixture();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/s/team/p/page?find=linked%20term"]}>
          <Provider>
            <SearchAndReplaceDialog editor={editor as any} editable={false} />
          </Provider>
        </MemoryRouter>,
      ),
    );
    expect(editor.commands.setSearchTerm).toHaveBeenCalledWith("linked term");
  });
  it("ignores an editor destroyed before passive effects during navigation", () => {
    const editor = editorFixture();
    function Navigation() {
      useLayoutEffect(() => {
        editor.isDestroyed = true;
        editor.storage = {};
      }, []);
      return <SearchAndReplaceDialog editor={editor as any} />;
    }
    expect(() => mount(<Navigation />)).not.toThrow();
    act(() => document.dispatchEvent(new Event("openFindDialogFromEditor")));
    expect(editor.commands.setSearchTerm).not.toHaveBeenCalled();
  });

  it("binds search events to the replacement editor after navigation", () => {
    const previous = editorFixture();
    const next = editorFixture();
    const render = (editor: ReturnType<typeof editorFixture>) => (
      <MemoryRouter>
        <Provider>
          <SearchAndReplaceDialog editor={editor as any} />
        </Provider>
      </MemoryRouter>
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(render(previous)));
    previous.commands.setSearchTerm.mockClear();
    previous.isDestroyed = true;
    previous.storage = {};
    act(() => root.render(render(next)));
    act(() => document.dispatchEvent(new Event("openFindDialogFromEditor")));
    expect(next.commands.setSearchTerm).toHaveBeenCalledWith("Selected text");
    expect(previous.commands.setSearchTerm).not.toHaveBeenCalled();
  });
});
