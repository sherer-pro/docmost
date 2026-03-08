import { IPageHistory } from "@/features/page-history/types/page.types";

type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export interface IHistoryEventDetail {
  id: string;
  title: string;
  lines: string[];
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

function formatValue(value: unknown, t: TranslateFn): string {
  if (value === null || typeof value === "undefined") {
    return tHistory(t, "history.event.value.empty");
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return tHistory(t, "history.event.value.empty");
    }

    return value.map((item) => formatValue(item, t)).join(", ");
  }

  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;

    if (typeof candidate.name === "string" && candidate.name.trim()) {
      return candidate.name;
    }

    if (typeof candidate.label === "string" && candidate.label.trim()) {
      return candidate.label;
    }

    if (typeof candidate.id === "string" && candidate.id.trim()) {
      return candidate.id;
    }

    return JSON.stringify(candidate);
  }

  return String(value);
}

function formatFieldName(field: string, t: TranslateFn): string {
  const mapping: Record<string, string> = {
    status: tHistory(t, "history.event.field.status"),
    assigneeId: tHistory(t, "history.event.field.assignee"),
    stakeholderIds: tHistory(t, "history.event.field.stakeholders"),
    name: tHistory(t, "history.event.field.name"),
    type: tHistory(t, "history.event.field.type"),
    settings: tHistory(t, "history.event.field.settings"),
  };

  return mapping[field] ?? field;
}

function formatFieldChangeLine(change: unknown, t: TranslateFn): string | null {
  if (!isRecord(change) || typeof change.field !== "string") {
    return null;
  }

  return tHistory(t, "history.event.field.changed", {
    field: formatFieldName(change.field, t),
    oldValue: formatValue(change.oldValue, t),
    newValue: formatValue(change.newValue, t),
  });
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
): string[] {
  return asArray(changeData.changes)
    .map((change) => {
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

      return tHistory(t, "history.event.field.changed", {
        field: fieldName,
        oldValue: formatValue(change.oldValue, t),
        newValue: formatValue(change.newValue, t),
      });
    })
    .filter((line): line is string => Boolean(line));
}

function buildEventDetail(
  changeType: string,
  changeData: Record<string, unknown>,
  t: TranslateFn,
  id: string,
): IHistoryEventDetail {
  if (changeType === "page.custom-fields.updated") {
    const lines = asArray(changeData.changes)
      .map((change) => formatFieldChangeLine(change, t))
      .filter((line): line is string => Boolean(line));

    return {
      id,
      title: tHistory(t, "history.event.custom-fields.updated"),
      lines,
    };
  }

  if (changeType === "database.property.created") {
    return {
      id,
      title: tHistory(t, "history.event.database.property.created", {
        propertyName: formatPropertyName(changeData, t),
      }),
      lines: [],
    };
  }

  if (changeType === "database.property.updated") {
    const lines = asArray(changeData.changes)
      .map((change) => formatFieldChangeLine(change, t))
      .filter((line): line is string => Boolean(line));

    return {
      id,
      title: tHistory(t, "history.event.database.property.updated", {
        propertyName: formatPropertyName(changeData, t),
      }),
      lines,
    };
  }

  if (changeType === "database.property.deleted") {
    return {
      id,
      title: tHistory(t, "history.event.database.property.deleted", {
        propertyName: formatPropertyName(changeData, t),
      }),
      lines: [],
    };
  }

  if (changeType === "database.row.created") {
    return {
      id,
      title: tHistory(t, "history.event.database.row.created", {
        rowTitle: formatRowTitle(changeData, t),
      }),
      lines: [],
    };
  }

  if (changeType === "database.row.deleted") {
    const rowContext = isRecord(changeData.rowContext) ? changeData.rowContext : {};
    const deletedCount = asArray(rowContext.descendantPageIds).length;

    return {
      id,
      title: tHistory(t, "history.event.database.row.deleted", { deletedCount }),
      lines: [],
    };
  }

  if (changeType === "database.row.cells.updated") {
    const lines = formatRowCellFieldChanges(changeData, t);
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
      lines,
    };
  }

  if (changeType === "page.converted.to-database") {
    return {
      id,
      title: tHistory(t, "history.event.conversion.page-to-database"),
      lines: [],
    };
  }

  if (changeType === "database.converted.to-page") {
    return {
      id,
      title: tHistory(t, "history.event.conversion.database-to-page"),
      lines: [],
    };
  }

  return {
    id,
    title: tHistory(t, "history.event.document.changed"),
    lines: [],
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
        };
      }

      const nestedType =
        typeof event.changeType === "string"
          ? event.changeType
          : "history.event.document.changed";
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
