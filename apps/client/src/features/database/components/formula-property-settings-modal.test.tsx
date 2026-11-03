// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormulaPropertySettingsModal } from "./formula-property-settings-modal";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi
    .fn()
    .mockImplementation((media) => ({
      matches: false,
      media,
      addEventListener() {},
      removeEventListener() {},
    })),
});

const ownId = "00000000-0000-4000-8000-000000000001";
const missingId = "00000000-0000-4000-8000-000000000002";
const russian = {
  Save: "Сохранить",
  "dbTable.formulaExpression": "Выражение",
  "dbTable.formulaInvalid": "Некорректная формула",
  "dbTable.formulaErrorUnknownFunction":
    "Неизвестная функция формулы: {{name}}.",
  "dbTable.formulaErrorDependencyCycle": "В зависимостях формулы найден цикл.",
  "dbTable.formulaErrorSyntax": "Ошибка формулы в позиции {{position}}.",
  "dbTable.formulaErrorArity":
    "Число аргументов функции {{name}}: {{required}}.",
  "dbTable.formulaErrorArgumentType":
    "Аргумент функции {{name}} имеет несовместимый тип.",
  "dbTable.formulaErrorMissingProperty":
    "Формула ссылается на свойство, которого больше нет.",
};

describe("FormulaPropertySettingsModal localized rejection", () => {
  let root: Root | null;
  let container: HTMLDivElement | null;
  beforeEach(() =>
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    ),
  );
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it.each([
    ['eval("1")', "Неизвестная функция формулы: eval."],
    [`prop("${ownId}")`, "В зависимостях формулы найден цикл."],
    ["", "Ошибка формулы в позиции 1."],
    ["add(1)", "Число аргументов функции add: 2."],
    ['add("text", 1)', "Аргумент функции add имеет несовместимый тип."],
    [
      `prop("${missingId}")`,
      "Формула ссылается на свойство, которого больше нет.",
    ],
  ])(
    "keeps %s unsavable and associates the Russian detail with its field",
    async (expression, message) => {
      const i18n = createInstance();
      await i18n.init({
        lng: "ru-RU",
        resources: { "ru-RU": { translation: russian } },
        react: { useSuspense: false },
      });
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      const onSave = vi.fn(async () => {});
      await act(async () => {
        root!.render(
          <MantineProvider env="test">
            <I18nextProvider i18n={i18n}>
              <FormulaPropertySettingsModal
                opened
                title="Формула"
                propertyId={ownId}
                initialSettings={{
                  languageVersion: 1,
                  expression,
                  resultType: "number",
                }}
                properties={[]}
                onClose={() => {}}
                onSave={onSave}
              />
            </I18nextProvider>
          </MantineProvider>,
        );
      });
      const textarea = document.querySelector("textarea")!;
      const errorId = textarea.getAttribute("aria-describedby");
      expect(textarea.getAttribute("aria-invalid")).toBe("true");
      expect(errorId).toBeTruthy();
      expect(document.getElementById(errorId!)?.textContent).toBe(message);
      const save = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Сохранить",
      )!;
      expect(save.disabled).toBe(true);
      act(() => save.click());
      expect(onSave).not.toHaveBeenCalled();

      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      await act(async () => {
        setter.call(textarea, "add(1, 2)");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(save.disabled).toBe(false);
      await act(async () => save.click());
      expect(onSave).toHaveBeenCalledWith({
        languageVersion: 1,
        expression: "add(1, 2)",
        resultType: "number",
      });
    },
  );
});
