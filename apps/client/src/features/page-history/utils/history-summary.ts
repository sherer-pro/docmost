import { IPageHistory } from "@/features/page-history/types/page.types";

type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export interface IHistoryEventDetailRow {
  id: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export interface IHistoryEventDetail {
  id: string;
  title: string;
  lines: string[];
  rows: IHistoryEventDetailRow[];
}

interface IHistoryFieldChangeRow extends IHistoryEventDetailRow {
  line: string;
}

function tHistory(
  t: TranslateFn,
  key: string,
  options?: Record<string, unknown>,
): string {
  return t(key, { keySeparator: false, ...options });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const SERIALIZED_VALUE_NORMALIZE_DEPTH = 6;

const DATABASE_PROPERTY_TYPE_LABEL_KEYS: Record<string, string> = {
  multiline_text: "history.event.property-type.multiline_text",
  checkbox: "history.event.property-type.checkbox",
  code: "history.event.property-type.code",
  select: "history.event.property-type.select",
  user: "history.event.property-type.user",
  page_reference: "history.event.property-type.page_reference",
  text: "history.event.property-type.multiline_text",
};

interface IFormatValueContext {
  field?: string;
  propertyType?: string | null;
}

function normalizeSerializedValue(value: string): unknown {
  let normalizedValue: unknown = value;

  for (
    let normalizeIteration = 0;
    normalizeIteration < SERIALIZED_VALUE_NORMALIZE_DEPTH;
    normalizeIteration += 1
  ) {
    if (typeof normalizedValue !== "string") {
      break;
    }

    const trimmedValue = normalizedValue.trim();
    if (!trimmedValue) {
      return "";
    }

    const canBeJson =
      trimmedValue.startsWith("{") ||
      trimmedValue.startsWith("[") ||
      trimmedValue.startsWith('"') ||
      trimmedValue === "true" ||
      trimmedValue === "false" ||
      trimmedValue === "null";

    if (!canBeJson) {
      return normalizedValue;
    }

    try {
      normalizedValue = JSON.parse(trimmedValue);
    } catch {
      return normalizedValue;
    }
  }

  return normalizedValue;
}

function formatDatabasePropertyType(value: unknown, t: TranslateFn): string {
  if (typeof value !== "string") {
    return String(value);
  }

  const normalizedType = value.trim();
  const labelKey = DATABASE_PROPERTY_TYPE_LABEL_KEYS[normalizedType];
  if (!labelKey) {
    return normalizedType;
  }

  const translatedLabel = tHistory(t, labelKey);
  return translatedLabel === labelKey ? normalizedType : translatedLabel;
}

function formatSelectSettingsValue(value: unknown, t: TranslateFn): string {
  if (!isRecord(value) || !Array.isArray(value.options)) {
    return JSON.stringify(value);
  }

  const options = value.options
    .map((option) => {
      if (!isRecord(option)) {
        return null;
      }

      if (typeof option.label === "string" && option.label.trim()) {
        return option.label;
      }

      if (typeof option.value === "string" && option.value.trim()) {
        return option.value;
      }

      return null;
    })
    .filter((option): option is string => Boolean(option));

  if (options.length === 0) {
    return tHistory(t, "history.event.value.empty");
  }

  return options.join(", ");
}

function formatValue(
  value: unknown,
  t: TranslateFn,
  context: IFormatValueContext = {},
): string {
  if (value === null || typeof value === "undefined") {
    return tHistory(t, "history.event.value.empty");
  }

  if (typeof value === "boolean") {
    return value
      ? tHistory(t, "history.event.value.true")
      : tHistory(t, "history.event.value.false");
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return tHistory(t, "history.event.value.empty");
    }

    return value.map((item) => formatValue(item, t, context)).join(", ");
  }

  if (typeof value === "string") {
    const normalizedValue = normalizeSerializedValue(value);
    if (normalizedValue !== value) {
      return formatValue(normalizedValue, t, context);
    }

    if (context.field === "type") {
      return formatDatabasePropertyType(value, t);
    }

    return value;
  }

  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;

    if (context.field === "settings") {
      return formatSelectSettingsValue(candidate, t);
    }

    if (typeof candidate.label === "string" && candidate.label.trim()) {
      return candidate.label;
    }

    if (typeof candidate.title === "string" && candidate.title.trim()) {
      return candidate.title;
    }

    if (typeof candidate.name === "string" && candidate.name.trim()) {
      return candidate.name;
    }

    if (context.field === "type" && typeof candidate.value === "string") {
      return formatDatabasePropertyType(candidate.value, t);
    }

    if (typeof candidate.value === "string" && candidate.value.trim()) {
      if (context.field === "type") {
        return formatDatabasePropertyType(candidate.value, t);
      }

      return candidate.value;
    }

    if (typeof candidate.id === "string" && candidate.id.trim()) {
      return candidate.id;
    }

    if (typeof candidate.pageId === "string" && candidate.pageId.trim()) {
      return candidate.pageId;
    }

    return JSON.stringify(candidate);
  }

  if (context.field === "type") {
    return formatDatabasePropertyType(value, t);
  }

  return String(value);
}

function formatFieldName(field: string, t: TranslateFn): string {
  const mapping: Record<string, string> = {
    status: tHistory(t, "history.event.field.status"),
    assigneeId: tHistory(t, "history.event.field.assignee"),
    stakeholderIds: tHistory(t, "history.event.field.stakeholders"),
    name: tHistory(t, "history.event.field.name"),
    title: tHistory(t, "history.event.field.title"),
    type: tHistory(t, "history.event.field.type"),
    settings: tHistory(t, "history.event.field.settings"),
    slugId: tHistory(t, "history.event.field.slug"),
  };

  return mapping[field] ?? field;
}

function formatFieldChangeRow(
  change: unknown,
  t: TranslateFn,
  rowId: string,
): IHistoryFieldChangeRow | null {
  if (!isRecord(change) || typeof change.field !== "string") {
    return null;
  }

  const field = formatFieldName(change.field, t);
  const oldValue = formatValue(change.oldValue, t, {
    field: change.field,
  });
  const newValue = formatValue(change.newValue, t, {
    field: change.field,
  });

  return {
    id: rowId,
    field,
    oldValue,
    newValue,
    line: tHistory(t, "history.event.field.changed", {
      field,
      oldValue,
      newValue,
    }),
  };
}

function formatPropertyName(changeData: Record<string, unknown>, t: TranslateFn): string {
  const property = isRecord(changeData.property) ? changeData.property : {};
  return typeof property.name === "string" && property.name
    ? property.name
    : tHistory(t, "history.event.property.untitled");
}

function formatRowTitle(changeData: Record<string, unknown>, t: TranslateFn): string {
  const row = isRecord(changeData.row) ? changeData.row : {};
  return typeof row.title === "string" && row.title.trim()
    ? row.title
    : tHistory(t, "history.event.row.untitled");
}

function formatRowCellFieldChanges(
  changeData: Record<string, unknown>,
  t: TranslateFn,
  eventId: string,
): IHistoryFieldChangeRow[] {
  return asArray(changeData.changes)
    .map((change, index) => {
      if (!isRecord(change)) {
        return null;
      }

      const fieldName =
        typeof change.propertyName === "string"
          ? change.propertyName
          : typeof change.propertyId === "string"
            ? change.propertyId
            : null;

      if (!fieldName) {
        return null;
      }

      const oldValue = formatValue(change.oldValue, t, {
        propertyType:
          typeof change.propertyType === "string" ? change.propertyType : null,
      });
      const newValue = formatValue(change.newValue, t, {
        propertyType:
          typeof change.propertyType === "string" ? change.propertyType : null,
      });

      return {
        id: `${eventId}-change-${index}`,
        field: fieldName,
        oldValue,
        newValue,
        line: tHistory(t, "history.event.field.changed", {
          field: fieldName,
          oldValue,
          newValue,
        }),
      };
    })
    .filter((row): row is IHistoryFieldChangeRow => Boolean(row));
}

function buildEventDetail(
  changeType: string,
  changeData: Record<string, unknown>,
  t: TranslateFn,
  id: string,
): IHistoryEventDetail {
  if (changeType === "page.custom-fields.updated") {
    const rows = asArray(changeData.changes)
      .map((change, index) =>
        formatFieldChangeRow(change, t, `${id}-change-${index}`),
      )
      .filter((row): row is IHistoryFieldChangeRow => Boolean(row));

    return {
      id,
      title: tHistory(t, "history.event.custom-fields.updated"),
      lines: rows.map((row) => row.line),
      rows,
    };
  }

  if (changeType === "database.property.created") {
    return {
      id,
      title: tHistory(t, "history.event.database.property.created", {
        propertyName: formatPropertyName(changeData, t),
      }),
      lines: [],
      rows: [],
    };
  }

  if (changeType === "database.property.updated") {
    const rows = asArray(changeData.changes)
      .map((change, index) =>
        formatFieldChangeRow(change, t, `${id}-change-${index}`),
      )
      .filter((row): row is IHistoryFieldChangeRow => Boolean(row));

    return {
      id,
      title: tHistory(t, "history.event.database.property.updated", {
        propertyName: formatPropertyName(changeData, t),
      }),
      lines: rows.map((row) => row.line),
      rows,
    };
  }

  if (changeType === "database.property.deleted") {
    return {
      id,
      title: tHistory(t, "history.event.database.property.deleted", {
        propertyName: formatPropertyName(changeData, t),
      }),
      lines: [],
      rows: [],
    };
  }

  if (changeType === "database.row.created") {
    return {
      id,
      title: tHistory(t, "history.event.database.row.created", {
        rowTitle: formatRowTitle(changeData, t),
      }),
      lines: [],
      rows: [],
    };
  }

  if (changeType === "database.row.deleted") {
    const rowContext = isRecord(changeData.rowContext) ? changeData.rowContext : {};
    const deletedCount = asArray(rowContext.descendantPageIds).length;

    return {
      id,
      title: tHistory(t, "history.event.database.row.deleted", { deletedCount }),
      lines: [],
      rows: [],
    };
  }

  if (changeType === "database.row.renamed") {
    const rows = asArray(changeData.changes)
      .map((change, index) =>
        formatFieldChangeRow(change, t, `${id}-change-${index}`),
      )
      .filter((row): row is IHistoryFieldChangeRow => Boolean(row));

    return {
      id,
      title: tHistory(t, "history.event.database.row.renamed", {
        rowTitle: formatRowTitle(changeData, t),
      }),
      lines: rows.map((row) => row.line),
      rows,
    };
  }

  if (changeType === "database.row.cells.updated") {
    const rows = formatRowCellFieldChanges(changeData, t, id);
    const fields = asArray(changeData.changes)
      .map((change) =>
        isRecord(change) && typeof change.propertyName === "string"
          ? change.propertyName
          : null,
      )
      .filter((name): name is string => Boolean(name));
    const uniqueFields = [...new Set(fields)];

    return {
      id,
      title:
        uniqueFields.length > 0
          ? tHistory(t, "history.event.database.row.cells.updated.with-fields", {
              fields: uniqueFields.join(", "),
            })
          : tHistory(t, "history.event.database.row.cells.updated"),
      lines: rows.map((row) => row.line),
      rows,
    };
  }

  if (changeType === "page.converted.to-database") {
    return {
      id,
      title: tHistory(t, "history.event.conversion.page-to-database"),
      lines: [],
      rows: [],
    };
  }

  if (changeType === "database.converted.to-page") {
    return {
      id,
      title: tHistory(t, "history.event.conversion.database-to-page"),
      lines: [],
      rows: [],
    };
  }

  return {
    id,
    title: tHistory(t, "history.event.document.changed"),
    lines: [],
    rows: [],
  };
}

export function formatHistoryEventDetails(
  historyItem: IPageHistory,
  t: TranslateFn,
): IHistoryEventDetail[] {
  const changeType = historyItem.changeType;
  if (!changeType) {
    return [];
  }

  const changeData = isRecord(historyItem.changeData) ? historyItem.changeData : {};

  if (changeType === "page.events.combined") {
    const events = asArray(changeData.events);
    return events.map((event, index) => {
      if (!isRecord(event)) {
        return {
          id: `${historyItem.id}-event-${index}`,
          title: tHistory(t, "history.event.document.changed"),
          lines: [],
          rows: [],
        };
      }

      const nestedType =
        typeof event.changeType === "string"
          ? event.changeType
          : "";
      const nestedData = isRecord(event.changeData) ? event.changeData : {};

      return buildEventDetail(
        nestedType,
        nestedData,
        t,
        `${historyItem.id}-event-${index}`,
      );
    });
  }

  return [buildEventDetail(changeType, changeData, t, historyItem.id)];
}

export function formatHistorySummary(
  historyItem: IPageHistory,
  t: TranslateFn,
): string {
  if (historyItem.changeType === "page.events.combined") {
    const details = formatHistoryEventDetails(historyItem, t);
    return tHistory(t, "history.event.combined", { count: details.length });
  }

  const details = formatHistoryEventDetails(historyItem, t);
  if (details.length === 0) {
    return tHistory(t, "history.event.document.changed");
  }

  return details[0].title;
}
