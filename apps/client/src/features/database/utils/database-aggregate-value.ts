import {
  databaseComparableType,
  formatDatabaseValue,
  type DatabaseViewState,
} from "@docmost/api-contract";
import type { IDatabaseProperty } from "../types/database.types";

export function formatDatabaseAggregate(
  property: Pick<IDatabaseProperty, "type" | "settings"> | undefined,
  calculation: DatabaseViewState["calculations"][string] | undefined,
  value: unknown,
  locale?: string,
): string {
  if (value === null || value === undefined) return "";
  if (["count", "filled", "empty"].includes(calculation ?? "")) {
    return typeof value === "number"
      ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
          value,
        )
      : "";
  }
  if (!property)
    return typeof value === "number"
      ? new Intl.NumberFormat(locale).format(value)
      : String(value);
  const dateValue =
    databaseComparableType(property) === "date" && typeof value === "string"
      ? { start: value }
      : value;
  return formatDatabaseValue(
    property.type,
    dateValue,
    property.settings,
    locale,
  );
}
