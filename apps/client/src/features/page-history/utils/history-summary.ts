import { IPageHistory } from '@/features/page-history/types/page.types';

type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatValue(value: unknown, t: TranslateFn): string {
  if (value === null || typeof value === 'undefined') {
    return t('history.event.value.empty');
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return t('history.event.value.empty');
    }

    return value.join(', ');
  }

  if (typeof value === 'object') {
    if ('id' in (value as Record<string, unknown>)) {
      const idValue = (value as Record<string, unknown>).id;
      if (typeof idValue === 'string' && idValue) {
        return idValue;
      }
    }

    return JSON.stringify(value);
  }

  return String(value);
}

function formatFieldName(field: string, t: TranslateFn): string {
  const mapping: Record<string, string> = {
    status: t('history.event.field.status'),
    assigneeId: t('history.event.field.assignee'),
    stakeholderIds: t('history.event.field.stakeholders'),
    name: t('history.event.field.name'),
    type: t('history.event.field.type'),
    settings: t('history.event.field.settings'),
  };

  return mapping[field] ?? field;
}

export function formatHistorySummary(
  historyItem: IPageHistory,
  t: TranslateFn,
): string {
  const changeType = historyItem.changeType;
  const changeData = isRecord(historyItem.changeData) ? historyItem.changeData : {};

  if (!changeType) {
    return t('history.event.document.changed');
  }

  if (changeType === 'page.custom-fields.updated') {
    const changes = asArray(changeData.changes)
      .map((change) => {
        if (!isRecord(change) || typeof change.field !== 'string') {
          return null;
        }

        return t('history.event.field.changed', {
          field: formatFieldName(change.field, t),
          oldValue: formatValue(change.oldValue, t),
          newValue: formatValue(change.newValue, t),
        });
      })
      .filter((line): line is string => Boolean(line));

    if (changes.length > 0) {
      return changes.join('; ');
    }

    return t('history.event.custom-fields.updated');
  }

  if (changeType === 'database.property.created') {
    const property = isRecord(changeData.property) ? changeData.property : {};
    const propertyName =
      typeof property.name === 'string' && property.name
        ? property.name
        : t('history.event.property.untitled');

    return t('history.event.database.property.created', { propertyName });
  }

  if (changeType === 'database.property.updated') {
    const property = isRecord(changeData.property) ? changeData.property : {};
    const propertyName =
      typeof property.name === 'string' && property.name
        ? property.name
        : t('history.event.property.untitled');
    const changes = asArray(changeData.changes)
      .map((change) => {
        if (!isRecord(change) || typeof change.field !== 'string') {
          return null;
        }

        return t('history.event.field.changed', {
          field: formatFieldName(change.field, t),
          oldValue: formatValue(change.oldValue, t),
          newValue: formatValue(change.newValue, t),
        });
      })
      .filter((line): line is string => Boolean(line));

    if (changes.length > 0) {
      return t('history.event.database.property.updated.with-details', {
        propertyName,
        details: changes.join('; '),
      });
    }

    return t('history.event.database.property.updated', { propertyName });
  }

  if (changeType === 'database.property.deleted') {
    const property = isRecord(changeData.property) ? changeData.property : {};
    const propertyName =
      typeof property.name === 'string' && property.name
        ? property.name
        : t('history.event.property.untitled');

    return t('history.event.database.property.deleted', { propertyName });
  }

  if (changeType === 'database.row.created') {
    const row = isRecord(changeData.row) ? changeData.row : {};
    const rowTitle =
      typeof row.title === 'string' && row.title.trim()
        ? row.title
        : t('history.event.row.untitled');

    return t('history.event.database.row.created', { rowTitle });
  }

  if (changeType === 'database.row.deleted') {
    const rowContext = isRecord(changeData.rowContext) ? changeData.rowContext : {};
    const descendantPageIds = asArray(rowContext.descendantPageIds);
    const deletedCount = descendantPageIds.length;

    return t('history.event.database.row.deleted', { deletedCount });
  }

  if (changeType === 'database.row.cells.updated') {
    const changes = asArray(changeData.changes);
    const propertyNames = changes
      .map((change) =>
        isRecord(change) && typeof change.propertyName === 'string'
          ? change.propertyName
          : null,
      )
      .filter((name): name is string => Boolean(name));
    const uniquePropertyNames = [...new Set(propertyNames)];

    if (uniquePropertyNames.length > 0) {
      return t('history.event.database.row.cells.updated.with-fields', {
        fields: uniquePropertyNames.join(', '),
      });
    }

    return t('history.event.database.row.cells.updated');
  }

  if (changeType === 'page.converted.to-database') {
    return t('history.event.conversion.page-to-database');
  }

  if (changeType === 'database.converted.to-page') {
    return t('history.event.conversion.database-to-page');
  }

  return t('history.event.document.changed');
}
