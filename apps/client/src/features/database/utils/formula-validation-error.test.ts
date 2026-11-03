import { describe, expect, it } from "vitest";
import { validateDatabaseFormulaSchema } from "@docmost/api-contract";
import {
  classifyFormulaValidationError,
  formulaValidationKeys,
} from "./formula-validation-error";

const ownId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
function validate(expression: string, properties: any[] = []) {
  try {
    validateDatabaseFormulaSchema([
      ...properties,
      {
        id: ownId,
        type: "formula",
        settings: { languageVersion: 1, resultType: "number", expression },
      },
    ]);
    return null;
  } catch (error) {
    const originalMessage = (error as Error).message;
    const diagnostic = classifyFormulaValidationError(error);
    expect((error as Error).message).toBe(originalMessage);
    return diagnostic;
  }
}

describe("client formula validation diagnostics", () => {
  it.each([
    ["", { code: "syntax", params: { position: 1 } }],
    [
      "add(1, 2",
      { code: "expectedToken", params: { token: ")", position: 9 } },
    ],
    ["1;", { code: "trailingText", params: { position: 2 } }],
    ["add(1)", { code: "arity", params: { name: "add", required: 2 } }],
    ['add("text", 1)', { code: "argumentType", params: { name: "add" } }],
    ['eval("1")', { code: "unknownFunction", params: { name: "eval" } }],
    [`prop("${otherId}")`, { code: "missingProperty" }],
    [`prop("${ownId}")`, { code: "dependencyCycle" }],
    ['"text"', { code: "resultTypeMismatch" }],
  ])(
    "classifies rejected expression %s without changing shared errors",
    (expression, expected) => {
      expect(validate(expression as string)).toEqual(expected);
    },
  );

  it("keeps valid expressions and dependency resolution unchanged", () => {
    expect(validate("add(1, 2)")).toBeNull();
    expect(
      validate(`prop("${otherId}")`, [{ id: otherId, type: "number" }]),
    ).toBeNull();
    expect(
      validate(`prop("${otherId}")`, [{ id: otherId, type: "user" }]),
    ).toEqual({ code: "unsupportedProperty" });
  });

  it("bounds optional parameters and never exposes unexpected error messages", () => {
    for (const error of [
      new Error("Private provider failure"),
      new Error("constructor"),
      new Error("Unknown formula function: " + "x".repeat(1000)),
      new Error("Invalid custom argument type"),
      "Formula dependency cycle",
      null,
    ]) {
      expect(classifyFormulaValidationError(error)).toEqual({
        code: "invalid",
      });
    }
    expect(formulaValidationKeys.invalid).toBe("dbTable.formulaInvalid");
  });
});
