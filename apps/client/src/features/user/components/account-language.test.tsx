// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentUserAtom } from "../atoms/current-user-atom";
import AccountLanguage from "./account-language";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { changeLanguageMock, notificationMock, updateUserMock } = vi.hoisted(
  () => ({
    changeLanguageMock: vi.fn(),
    notificationMock: vi.fn(),
    updateUserMock: vi.fn(),
  }),
);

vi.mock("../services/user-service", () => ({
  updateUser: updateUserMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
    i18n: { changeLanguage: changeLanguageMock },
  }),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: notificationMock },
}));

vi.mock("@mantine/core", () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  Select: ({
    disabled,
    onChange,
    value,
  }: {
    disabled?: boolean;
    onChange: (value: string | null) => void;
    value: string;
  }) => (
    <button
      data-value={value}
      disabled={disabled}
      onClick={() => onChange("de-DE")}
      type="button"
    >
      Select language
    </button>
  ),
}));

function renderLanguage() {
  const user = {
    id: "user-1",
    locale: "en-US",
    settings: { preferences: {} },
  } as any;
  const store = createStore();
  store.set(currentUserAtom, {
    user,
    workspace: { id: "workspace-1" },
  } as any);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <Provider store={store}>
        <AccountLanguage />
      </Provider>,
    );
  });

  return { container, root, store };
}

describe("AccountLanguage", () => {
  let mountedRoot: Root | null = null;
  let mountedContainer: HTMLElement | null = null;

  afterEach(() => {
    updateUserMock.mockReset();
    changeLanguageMock.mockReset();
    notificationMock.mockReset();
    if (mountedRoot && mountedContainer) {
      act(() => mountedRoot?.unmount());
      mountedContainer.remove();
    }
    mountedRoot = null;
    mountedContainer = null;
  });

  it("keeps the previous locale and reports a persistence failure", async () => {
    updateUserMock.mockRejectedValue(new Error("synthetic failure"));
    const { container, root, store } = renderLanguage();
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.get(currentUserAtom)?.user.locale).toBe("en-US");
    expect(changeLanguageMock).not.toHaveBeenCalled();
    expect(notificationMock).toHaveBeenCalledWith({
      color: "red",
      message: "Failed to update data",
    });
    expect(container.querySelector("button")?.dataset.value).toBe("en-US");
  });
});
