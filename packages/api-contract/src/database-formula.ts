export type DatabaseFormulaType = "number" | "text" | "date" | "checkbox";
export type DatabaseFormulaNode =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "property"; id: string }
  | { kind: "call"; name: string; args: DatabaseFormulaNode[] };
export interface DatabaseFormulaSettings {
  languageVersion: 1;
  expression: string;
  resultType: DatabaseFormulaType;
}
export const DATABASE_FORMULA_FUNCTIONS = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "if",
  "eq",
  "gt",
  "and",
  "or",
  "not",
  "concat",
  "text",
  "length",
  "trim",
  "slice",
  "date",
  "dateAdd",
  "dateDiff",
] as const;
const arity: Record<string, number> = {
  add: 2,
  subtract: 2,
  multiply: 2,
  divide: 2,
  if: 3,
  eq: 2,
  gt: 2,
  and: 2,
  or: 2,
  not: 1,
  concat: 2,
  text: 1,
  length: 1,
  trim: 1,
  slice: 3,
  date: 1,
  dateAdd: 2,
  dateDiff: 2,
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// This grammar accepts only literals, property IDs and a closed function set.
export function parseDatabaseFormula(expression: string): DatabaseFormulaNode {
  if (typeof expression !== "string" || expression.length > 4096)
    throw new Error("Formula must not exceed 4096 characters");
  let index = 0,
    nodes = 0;
  const space = () => {
    while (/\s/.test(expression[index] ?? "") && index < expression.length)
      index++;
  };
  const token = (pattern: RegExp) => {
    space();
    const match = pattern.exec(expression.slice(index));
    if (!match) throw new Error(`Invalid formula at ${index + 1}`);
    index += match[0].length;
    return match[0];
  };
  const punctuation = (value: string) => {
    space();
    if (expression[index++] !== value)
      throw new Error(`Expected ${value} at ${index}`);
  };
  const node = (depth: number): DatabaseFormulaNode => {
    if (++nodes > 128 || depth > 16) throw new Error("Formula is too complex");
    space();
    if (expression[index] === '"') {
      const value = JSON.parse(
        token(/^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/),
      );
      if (value.length > 1024) throw new Error("Formula literal is too long");
      if (
        value.includes("\0") ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          value,
        )
      )
        throw new Error("Invalid formula string");
      return { kind: "literal", value };
    }
    if (/[\d+.-]/.test(expression[index] ?? "")) {
      const value = Number(
        token(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/),
      );
      if (!Number.isFinite(value) || Math.abs(value) > 1e15)
        throw new Error("Formula number is out of range");
      return { kind: "literal", value };
    }
    const name = token(/^[a-zA-Z][a-zA-Z0-9]*/);
    if (["true", "false", "null"].includes(name))
      return { kind: "literal", value: JSON.parse(name) };
    if (name !== "prop" && !Object.prototype.hasOwnProperty.call(arity, name))
      throw new Error(`Unknown formula function: ${name}`);
    punctuation("(");
    const args: DatabaseFormulaNode[] = [node(depth + 1)];
    space();
    while (expression[index] === ",") {
      punctuation(",");
      args.push(node(depth + 1));
      space();
    }
    punctuation(")");
    if (name === "prop") {
      if (
        args.length !== 1 ||
        args[0].kind !== "literal" ||
        typeof args[0].value !== "string" ||
        !(uuid.test(args[0].value) || args[0].value === "title")
      )
        throw new Error("prop requires one property UUID or title");
      return { kind: "property", id: args[0].value.toLowerCase() };
    }
    if (args.length !== arity[name])
      throw new Error(`${name} requires ${arity[name]} arguments`);
    return { kind: "call", name, args };
  };
  const result = node(0);
  space();
  if (index !== expression.length)
    throw new Error(`Unexpected formula text at ${index + 1}`);
  return result;
}

export function databaseFormulaDependencies(
  node: DatabaseFormulaNode,
): string[] {
  const ids = new Set<string>();
  const visit = (item: DatabaseFormulaNode) => {
    if (item.kind === "property") ids.add(item.id);
    else if (item.kind === "call") item.args.forEach(visit);
  };
  visit(node);
  return [...ids];
}

export function databaseFormulaType(
  node: DatabaseFormulaNode,
  propertyType: (id: string) => DatabaseFormulaType | null,
): DatabaseFormulaType | null {
  if (node.kind === "literal")
    return node.value === null
      ? null
      : typeof node.value === "boolean"
        ? "checkbox"
        : typeof node.value === "number"
          ? "number"
          : "text";
  if (node.kind === "property") return propertyType(node.id);
  const types = node.args.map((arg) => databaseFormulaType(arg, propertyType));
  const expect = (index: number, type: DatabaseFormulaType) => {
    if (types[index] !== null && types[index] !== type)
      throw new Error(`Invalid ${node.name} argument type`);
  };
  if (["add", "subtract", "multiply", "divide", "gt"].includes(node.name)) {
    expect(0, "number");
    expect(1, "number");
    return node.name === "gt" ? "checkbox" : "number";
  }
  if (node.name === "if") {
    expect(0, "checkbox");
    if (types[1] && types[2] && types[1] !== types[2])
      throw new Error("Formula branches must have the same type");
    return types[1] ?? types[2];
  }
  if (node.name === "eq") {
    if (types[0] && types[1] && types[0] !== types[1])
      throw new Error("Formula equality types must match");
    return "checkbox";
  }
  if (["and", "or", "not"].includes(node.name)) {
    types.forEach((_, index) => expect(index, "checkbox"));
    return "checkbox";
  }
  if (node.name === "dateAdd" || node.name === "dateDiff") {
    expect(0, "date");
    expect(1, node.name === "dateAdd" ? "number" : "date");
    return node.name === "dateAdd" ? "date" : "number";
  }
  if (node.name === "text") return "text";
  expect(0, "text");
  if (node.name === "concat") expect(1, "text");
  if (node.name === "slice") {
    expect(1, "number");
    expect(2, "number");
  }
  return node.name === "date"
    ? "date"
    : node.name === "length"
      ? "number"
      : "text";
}

export const isDatabaseComputedProperty = (type: string | null | undefined) =>
  ["created_at", "updated_at", "updated_by", "formula"].includes(type ?? "");

export function databaseComparableType(property?: {
  type: string | null;
  settings?: unknown;
}): string | null {
  if (!property) return null;
  if (property.type === "created_at" || property.type === "updated_at")
    return "date";
  if (property.type === "updated_by") return "user";
  if (property.type === "formula") {
    const type = (property.settings as DatabaseFormulaSettings)?.resultType;
    return type === "text" ? "multiline_text" : type;
  }
  return property.type;
}

export function validateDatabaseFormulaSchema(
  properties: Array<{ id: string; type: string | null; settings?: unknown }>,
): Map<string, DatabaseFormulaNode> {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const formulas = new Map<string, DatabaseFormulaNode>();
  for (const property of properties) {
    if (property.type !== "formula") continue;
    const settings = property.settings as DatabaseFormulaSettings;
    if (
      !settings ||
      settings.languageVersion !== 1 ||
      !["number", "text", "date", "checkbox"].includes(settings.resultType) ||
      Object.keys(settings).some(
        (key) => !["languageVersion", "expression", "resultType"].includes(key),
      )
    )
      throw new Error("Invalid formula result type");
    const formula = parseDatabaseFormula(settings.expression);
    for (const id of databaseFormulaDependencies(formula))
      if (id !== "title" && !byId.has(id))
        throw new Error("Formula references a missing property");
    formulas.set(property.id, formula);
  }
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const types = new Map<string, DatabaseFormulaType | null>();
  const resolve = (id: string): DatabaseFormulaType | null => {
    if (id === "title") return "text";
    const property = byId.get(id);
    if (!property) throw new Error("Formula references a missing property");
    if (complete.has(id)) return types.get(id)!;
    if (visiting.has(id)) throw new Error("Formula dependency cycle");
    visiting.add(id);
    const formula = formulas.get(id);
    let type: DatabaseFormulaType | null;
    if (formula) {
      type = databaseFormulaType(formula, resolve);
      const expected = (property.settings as DatabaseFormulaSettings)
        .resultType;
      if (type !== null && type !== expected)
        throw new Error("Formula result type mismatch");
      type = expected;
    } else {
      const comparable = databaseComparableType(property);
      type = [
        "multiline_text",
        "code",
        "url",
        "email",
        "phone",
        "select",
      ].includes(comparable ?? "")
        ? "text"
        : ["number", "date", "checkbox"].includes(comparable ?? "")
          ? (comparable as DatabaseFormulaType)
          : null;
      if (type === null)
        throw new Error("This property cannot be used in a formula");
    }
    visiting.delete(id);
    complete.add(id);
    types.set(id, type);
    return type;
  };
  for (const id of formulas.keys()) resolve(id);
  if (formulas.size > 16)
    throw new Error("At most 16 formula properties are supported");
  for (const id of formulas.keys()) {
    const seen = new Set<string>();
    let count = 0;
    const visit = (item: DatabaseFormulaNode) => {
      if (++count > 400) throw new Error("Expanded formula is too complex");
      if (item.kind === "call") item.args.forEach(visit);
      else if (item.kind === "property" && !seen.has(item.id)) {
        seen.add(item.id);
        const dependency = formulas.get(item.id);
        if (dependency) visit(dependency);
      }
    };
    visit(formulas.get(id)!);
  }
  return formulas;
}

export function remapDatabaseFormulaSettings(
  settings: unknown,
  propertyIds: ReadonlyMap<string, string>,
): DatabaseFormulaSettings {
  const formula = settings as DatabaseFormulaSettings;
  if (formula?.languageVersion !== 1)
    throw new Error("Unsupported formula language");
  const serialize = (node: DatabaseFormulaNode): string => {
    if (node.kind === "literal") return JSON.stringify(node.value);
    if (node.kind === "property") {
      const id = node.id === "title" ? "title" : propertyIds.get(node.id);
      if (!id) throw new Error("Formula references a missing property");
      return `prop(${JSON.stringify(id)})`;
    }
    return `${node.name}(${node.args.map(serialize).join(", ")})`;
  };
  return {
    ...formula,
    expression: serialize(parseDatabaseFormula(formula.expression)),
  };
}
