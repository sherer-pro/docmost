import { DATABASE_FORMULA_FUNCTIONS } from "@docmost/api-contract";

export const formulaValidationKeys = {
  invalid: "dbTable.formulaInvalid",
  tooLong: "dbTable.formulaErrorTooLong",
  syntax: "dbTable.formulaErrorSyntax",
  expectedToken: "dbTable.formulaErrorExpectedToken",
  trailingText: "dbTable.formulaErrorTrailingText",
  tooComplex: "dbTable.formulaErrorTooComplex",
  literalTooLong: "dbTable.formulaErrorLiteralTooLong",
  invalidString: "dbTable.formulaErrorInvalidString",
  numberOutOfRange: "dbTable.formulaErrorNumberOutOfRange",
  unknownFunction: "dbTable.formulaErrorUnknownFunction",
  propertyReference: "dbTable.formulaErrorPropertyReference",
  arity: "dbTable.formulaErrorArity",
  argumentType: "dbTable.formulaErrorArgumentType",
  branchType: "dbTable.formulaErrorBranchType",
  equalityType: "dbTable.formulaErrorEqualityType",
  resultType: "dbTable.formulaErrorResultType",
  resultTypeMismatch: "dbTable.formulaErrorResultTypeMismatch",
  missingProperty: "dbTable.formulaErrorMissingProperty",
  dependencyCycle: "dbTable.formulaErrorDependencyCycle",
  unsupportedProperty: "dbTable.formulaErrorUnsupportedProperty",
  tooManyFormulas: "dbTable.formulaErrorTooManyFormulas",
} as const;

export interface FormulaValidationDiagnostic {
  code: keyof typeof formulaValidationKeys;
  params?: Record<string, string | number>;
}

const exactMessages: Record<string, FormulaValidationDiagnostic> = {
  "Formula must not exceed 4096 characters": {
    code: "tooLong",
    params: { limit: 4096 },
  },
  "Formula is too complex": { code: "tooComplex" },
  "Expanded formula is too complex": { code: "tooComplex" },
  "Formula literal is too long": {
    code: "literalTooLong",
    params: { limit: 1024 },
  },
  "Invalid formula string": { code: "invalidString" },
  "Formula number is out of range": {
    code: "numberOutOfRange",
    params: { limit: 1e15 },
  },
  "prop requires one property UUID or title": { code: "propertyReference" },
  "Formula branches must have the same type": { code: "branchType" },
  "Formula equality types must match": { code: "equalityType" },
  "Invalid formula result type": { code: "resultType" },
  "Formula result type mismatch": { code: "resultTypeMismatch" },
  "Formula references a missing property": { code: "missingProperty" },
  "Formula dependency cycle": { code: "dependencyCycle" },
  "This property cannot be used in a formula": { code: "unsupportedProperty" },
  "At most 16 formula properties are supported": {
    code: "tooManyFormulas",
    params: { limit: 16 },
  },
};

// Adapt only the shared parser's closed diagnostics; never show arbitrary errors.
export function classifyFormulaValidationError(
  error: unknown,
): FormulaValidationDiagnostic {
  if (!(error instanceof Error) || error.message.length > 4200)
    return { code: "invalid" };
  const message = error.message;
  if (Object.prototype.hasOwnProperty.call(exactMessages, message))
    return exactMessages[message];
  let match = /^Invalid formula at ([1-9]\d{0,3})$/.exec(message);
  if (match) return { code: "syntax", params: { position: Number(match[1]) } };
  match = /^Expected ([(),]) at ([1-9]\d{0,3})$/.exec(message);
  if (match)
    return {
      code: "expectedToken",
      params: { token: match[1], position: Number(match[2]) },
    };
  match = /^Unexpected formula text at ([1-9]\d{0,3})$/.exec(message);
  if (match)
    return { code: "trailingText", params: { position: Number(match[1]) } };
  match = /^Unknown formula function: ([a-zA-Z][a-zA-Z0-9]{0,63})$/.exec(
    message,
  );
  if (match) return { code: "unknownFunction", params: { name: match[1] } };
  match = /^([a-zA-Z][a-zA-Z0-9]*) requires ([1-3]) arguments$/.exec(message);
  if (match && DATABASE_FORMULA_FUNCTIONS.some((name) => name === match![1])) {
    return {
      code: "arity",
      params: { name: match[1], required: Number(match[2]) },
    };
  }
  match = /^Invalid ([a-zA-Z][a-zA-Z0-9]*) argument type$/.exec(message);
  if (match && DATABASE_FORMULA_FUNCTIONS.some((name) => name === match![1])) {
    return { code: "argumentType", params: { name: match[1] } };
  }
  return { code: "invalid" };
}
