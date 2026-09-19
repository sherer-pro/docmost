// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsDraftProvider,
  SettingsSaveBar,
  useSettingsDraft,
} from "./settings-draft";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@mantine/core", () => {
  const Wrapper = ({ children }: any) => <div>{children}</div>;
  return {
    Alert: Wrapper,
    Group: Wrapper,
    Stack: Wrapper,
    Text: Wrapper,
    Button: ({ children, variant, color, loading, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    Modal: ({ opened, children }: any) =>
      opened ? <div role="dialog">{children}</div> : null,
  };
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const NativeRequest = globalThis.Request;
// Node fetch and jsdom use different AbortSignal realms. These routes have no loaders.
vi.stubGlobal(
  "Request",
  class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, { ...init, signal: undefined });
    }
  },
);

describe("Settings draft navigation", () => {
  let root: Root;
  let container: HTMLDivElement;
  let router: ReturnType<typeof createMemoryRouter>;
  let refresh: (value: string) => void;
  const submit = vi.fn();
  function Editor() {
    const [source, setSource] = useState("original");
    refresh = setSource;
    const form = useSettingsDraft(source);
    return (
      <>
        <output>{form.value}</output>
        <span>{String(form.dirty)}</span>
        <span>{String(form.error)}</span>
        <button onClick={() => form.setValue("draft")}>Edit</button>
        <button onClick={() => void form.save(submit)}>Save</button>
        <SettingsSaveBar {...form} onCancel={form.reset} />
        <Link to="/other">Other</Link>
      </>
    );
  }
  async function mount() {
    submit.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    router = createMemoryRouter(
      [
        {
          path: "/edit",
          element: (
            <SettingsDraftProvider>
              <Editor />
            </SettingsDraftProvider>
          ),
        },
        { path: "/other", element: <div>Other page</div> },
      ],
      { initialEntries: ["/other", "/edit"] },
    );
    await act(async () => root.render(<RouterProvider router={router} />));
  }
  const click = async (text: string) =>
    act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === text)!
        .click(),
    );
  afterEach(() => {
    act(() => root?.unmount());
    router?.dispose();
    container?.remove();
  });
  it("preserves input on failed save and background refresh, then accepts the successful response", async () => {
    await mount();
    await click("Edit");
    await act(async () => refresh("remote"));
    expect(container.querySelector("output")!.textContent).toBe("draft");
    submit.mockRejectedValueOnce(new Error("offline"));
    await click("Save");
    expect(container.querySelector("output")!.textContent).toBe("draft");
    submit.mockResolvedValueOnce("saved");
    await click("Save");
    expect(container.querySelector("output")!.textContent).toBe("saved");
    await act(async () => router.navigate("/other"));
    expect(router.state.location.pathname).toBe("/other");
  });
  it("blocks links and Back, keeps editing, then discards only after confirmation", async () => {
    await mount();
    await click("Edit");
    await act(async () => router.navigate("/other"));
    expect(router.state.location.pathname).toBe("/edit");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click("spaceAdmin.keepEditing");
    await act(async () => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/edit");
    await click("spaceAdmin.discardAndLeave");
    expect(router.state.location.pathname).toBe("/other");
  });
  it("guards browser reload and clears the guard when the current form is cancelled", async () => {
    await mount();
    await click("Edit");
    const first = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    await act(async () => refresh("latest"));
    await click("Cancel");
    expect(container.querySelector("output")!.textContent).toBe("latest");
    const second = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
  });
});
