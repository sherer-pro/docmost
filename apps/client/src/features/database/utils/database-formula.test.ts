import { describe, expect, it } from "vitest";
import {
  parseDatabaseFormula,
  databaseFormulaType,
  databaseFormulaDependencies,
  validateDatabaseFormulaSchema,
  remapDatabaseFormulaSettings,
} from "../../../../../../packages/api-contract/src/database-formula";

const propertyId = "00000000-0000-4000-8000-000000000001";
describe("bounded row formula language", () => {
  it("preserves property IDs and type-checks conditional arithmetic", () => {
    const node = parseDatabaseFormula(
      `if(gt(prop("${propertyId}"), 0), divide(prop("${propertyId}"), 2), null)`,
    );
    expect(databaseFormulaDependencies(node)).toEqual([propertyId]);
    expect(databaseFormulaType(node, () => "number")).toBe("number");
    expect(() => databaseFormulaType(node, () => "text")).toThrow(
      "argument type",
    );
  });
  it("accepts bounded date, text and boolean operations", () => {
    expect(
      databaseFormulaType(
        parseDatabaseFormula('dateAdd(date("2026-10-31"), 1)'),
        () => null,
      ),
    ).toBe("date");
    expect(
      databaseFormulaType(
        parseDatabaseFormula('slice(trim(" text "), 0, 2)'),
        () => null,
      ),
    ).toBe("text");
    expect(
      databaseFormulaType(
        parseDatabaseFormula("and(true, not(false))"),
        () => null,
      ),
    ).toBe("checkbox");
  });
  it("rejects code, network calls, invalid references, arity and excessive complexity", () => {
    for (const expression of [
      'fetch("https://example.test")',
      "globalThis.process",
      'eval("1")',
      'prop("name")',
      "add(1)",
      'if(true, 1, "text")',
      "add(1, 1); delete()",
      "1e309",
      '"unterminated',
      "not(".repeat(18) + "true" + ")".repeat(18),
    ]) {
      expect(
        () => databaseFormulaType(parseDatabaseFormula(expression), () => null),
        expression,
      ).toThrow();
    }
  });
  it("rejects cycles, missing or private reference dependencies and incompatible schema changes", () => {
    const other = "00000000-0000-4000-8000-000000000002";
    const formula = {
      id: propertyId,
      type: "formula",
      settings: {
        languageVersion: 1,
        expression: `prop("${other}")`,
        resultType: "number",
      },
    };
    expect(() => validateDatabaseFormulaSchema([formula])).toThrow("missing");
    expect(() =>
      validateDatabaseFormulaSchema([
        formula,
        { id: other, type: "page_reference" },
      ]),
    ).toThrow("cannot be used");
    expect(() =>
      validateDatabaseFormulaSchema([
        formula,
        { id: other, type: "multiline_text" },
      ]),
    ).toThrow("mismatch");
    expect(() =>
      validateDatabaseFormulaSchema([
        formula,
        {
          id: other,
          type: "formula",
          settings: {
            languageVersion: 1,
            expression: `prop("${propertyId}")`,
            resultType: "number",
          },
        },
      ]),
    ).toThrow("cycle");
    expect(
      validateDatabaseFormulaSchema([formula, { id: other, type: "number" }])
        .size,
    ).toBe(1);
  });
  it("accepts title references and decimals and rejects PostgreSQL-incompatible string literals", () => {
    expect(parseDatabaseFormula(".5")).toEqual({ kind: "literal", value: 0.5 });
    expect(
      databaseFormulaType(
        parseDatabaseFormula('concat(prop("title"), " value")'),
        () => "text",
      ),
    ).toBe("text");
    expect(() => parseDatabaseFormula('"\\u0000"')).toThrow(
      "Invalid formula string",
    );
    expect(() => parseDatabaseFormula('"\\ud800"')).toThrow(
      "Invalid formula string",
    );
    expect(() => parseDatabaseFormula('"\\udc00"')).toThrow(
      "Invalid formula string",
    );
    expect(() => parseDatabaseFormula('"\\ud83d\\ude00"')).not.toThrow();
  });
  it("remaps dependency tokens without replacing UUID-like literal text", () => {
    const target = "00000000-0000-4000-8000-000000000003";
    const settings = remapDatabaseFormulaSettings(
      {
        languageVersion: 1,
        resultType: "text",
        expression: `concat(prop("${propertyId}"), "${propertyId}")`,
      },
      new Map([[propertyId, target]]),
    );
    expect(
      databaseFormulaDependencies(parseDatabaseFormula(settings.expression)),
    ).toEqual([target]);
    expect(settings.expression).toContain(`"${propertyId}"`);
    expect(() => remapDatabaseFormulaSettings(settings, new Map())).toThrow(
      "missing",
    );
    expect(() =>
      validateDatabaseFormulaSchema([
        {
          id: propertyId,
          type: "formula",
          settings: { ...settings, languageVersion: 2 },
        },
      ]),
    ).toThrow("result type");
  });
});
