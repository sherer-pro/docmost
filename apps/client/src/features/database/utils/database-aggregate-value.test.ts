import { describe, expect, it } from "vitest";
import { formatDatabaseAggregate } from "./database-aggregate-value";

const currency = {
  type: "number" as const,
  settings: { format: "currency" as const, currency: "RUB", precision: 2 },
};
const normalizeSpaces = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("database aggregate display", () => {
  it("uses the number property format for sum and average", () => {
    expect(
      normalizeSpaces(
        formatDatabaseAggregate(currency, "sum", 152908.25, "ru-RU"),
      ),
    ).toBe("152 908,25 ₽");
    expect(
      normalizeSpaces(
        formatDatabaseAggregate(currency, "average", -1.25, "ru-RU"),
      ),
    ).toBe("-1,25 ₽");
    expect(
      normalizeSpaces(formatDatabaseAggregate(currency, "min", 0, "ru-RU")),
    ).toBe("0,00 ₽");
  });
  it("formats count calculations as integers without currency or precision", () => {
    for (const calculation of ["count", "filled", "empty"] as const) {
      expect(
        normalizeSpaces(
          formatDatabaseAggregate(currency, calculation, 1234, "ru-RU"),
        ),
      ).toBe("1 234");
      expect(formatDatabaseAggregate(currency, calculation, 0, "ru-RU")).toBe(
        "0",
      );
    }
  });
  it("keeps formula result types independent of the source currency", () => {
    const formula = {
      type: "formula" as const,
      settings: {
        languageVersion: 1 as const,
        resultType: "number" as const,
        expression: "0",
      },
    };
    expect(
      normalizeSpaces(
        formatDatabaseAggregate(formula, "sum", 305816.5, "ru-RU"),
      ),
    ).toBe("305 816,5");
  });
  it("uses the declared date timezone for date aggregation strings", () => {
    const date = { type: "date" as const, settings: {} };
    expect(
      formatDatabaseAggregate(date, "earliest", "2026-11-05", "en-US"),
    ).toBe("Nov 5, 2026");
    const formula = {
      type: "formula" as const,
      settings: {
        languageVersion: 1 as const,
        resultType: "date" as const,
        expression: "0",
      },
    };
    expect(
      formatDatabaseAggregate(formula, "latest", "2026-11-12", "en-US"),
    ).toBe("Nov 12, 2026");
  });
  it("distinguishes empty values, formula errors and zero", () => {
    expect(formatDatabaseAggregate(currency, "sum", null, "en-US")).toBe("");
    expect(formatDatabaseAggregate(currency, "sum", undefined, "en-US")).toBe(
      "",
    );
    expect(
      formatDatabaseAggregate(currency, "sum", { error: "DIV_ZERO" }, "en-US"),
    ).toBe("#DIV_ZERO");
    expect(
      formatDatabaseAggregate(
        { type: "number", settings: {} },
        "max",
        0,
        "en-US",
      ),
    ).toBe("0");
  });
  it("updates separators with the requested locale and preserves percent settings", () => {
    const number = { type: "number" as const, settings: {} };
    expect(formatDatabaseAggregate(number, "sum", 1234.5, "en-US")).toBe(
      "1,234.5",
    );
    expect(formatDatabaseAggregate(number, "sum", 1234.5, "de-DE")).toBe(
      "1.234,5",
    );
    expect(
      formatDatabaseAggregate(
        { type: "number", settings: { format: "percent", precision: 1 } },
        "sum",
        0.125,
        "en-US",
      ),
    ).toBe("12.5%");
  });
});
