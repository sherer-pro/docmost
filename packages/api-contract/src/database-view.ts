import type {
  DatabaseFilterGroup,
  DatabaseFilterRule,
  DatabaseViewState,
} from "./database";

export function normalizeDatabaseViewState(input: unknown): DatabaseViewState {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, any>)
      : {};
  if (source.version !== undefined && source.version !== 2)
    throw new Error("Unsupported view version");
  const state: DatabaseViewState = {
    version: 2,
    filter:
      source.filter ??
      (Array.isArray(source.filters)
        ? { conjunction: "and", conditions: source.filters }
        : undefined),
    sorts: source.sorts ?? (source.sortState ? [source.sortState] : []),
    groupBy: source.groupBy ?? null,
    visibleColumns: source.visibleColumns ?? {},
    calculations: source.calculations ?? {},
  };
  let count = 0;
  const checkGroup = (group: DatabaseFilterGroup, depth: number): void => {
    if (
      !group ||
      !["and", "or"].includes(group.conjunction) ||
      !Array.isArray(group.conditions) ||
      depth > 2
    )
      throw new Error("Invalid filter group");
    for (const condition of group.conditions) {
      if (condition && "conjunction" in condition)
        checkGroup(condition, depth + 1);
      else {
        const rule = condition as DatabaseFilterRule;
        if (
          !rule ||
          typeof rule.propertyId !== "string" ||
          ![
            "contains",
            "not_contains",
            "equals",
            "not_equals",
            "is_empty",
            "is_not_empty",
            "gt",
            "gte",
            "lt",
            "lte",
            "between",
          ].includes(rule.operator) ||
          ++count > 10
        )
          throw new Error("Invalid filter rule");
      }
    }
  };
  if (state.filter) checkGroup(state.filter, 1);
  if (
    !Array.isArray(state.sorts) ||
    state.sorts.length > 5 ||
    state.sorts.some(
      (sort) =>
        !sort ||
        typeof sort.propertyId !== "string" ||
        !["asc", "desc"].includes(sort.direction),
    ) ||
    new Set(state.sorts.map((sort) => sort.propertyId)).size !==
      state.sorts.length
  )
    throw new Error("Invalid sorts");
  if (state.groupBy !== null && typeof state.groupBy !== "string")
    throw new Error("Invalid grouping");
  if (
    !state.visibleColumns ||
    typeof state.visibleColumns !== "object" ||
    Array.isArray(state.visibleColumns) ||
    Object.values(state.visibleColumns).some((v) => typeof v !== "boolean")
  )
    throw new Error("Invalid column visibility");
  if (
    !state.calculations ||
    typeof state.calculations !== "object" ||
    Array.isArray(state.calculations) ||
    Object.values(state.calculations).some(
      (v) =>
        ![
          "count",
          "filled",
          "empty",
          "sum",
          "average",
          "min",
          "max",
          "earliest",
          "latest",
        ].includes(String(v)),
    )
  )
    throw new Error("Invalid calculations");
  return state;
}

export function getDatabaseViewPropertyIds(state: DatabaseViewState): string[] {
  const ids = new Set([
    ...state.sorts.map((sort) => sort.propertyId),
    ...Object.keys(state.visibleColumns),
    ...Object.keys(state.calculations),
    ...(state.groupBy ? [state.groupBy] : []),
  ]);
  const collect = (group: DatabaseFilterGroup) =>
    group.conditions.forEach((condition) =>
      "conjunction" in condition
        ? collect(condition)
        : ids.add(condition.propertyId),
    );
  if (state.filter) collect(state.filter);
  return [...ids].filter((id) => id !== "title");
}
