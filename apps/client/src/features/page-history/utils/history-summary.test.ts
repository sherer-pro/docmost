import { describe, expect, it } from 'vitest';
import { formatHistorySummary } from './history-summary';
import { IPageHistory } from '@/features/page-history/types/page.types';

const t = (key: string, options?: Record<string, unknown>) =>
  `${key}${options ? ` ${JSON.stringify(options)}` : ''}`;

function createHistoryItem(overrides: Partial<IPageHistory>): IPageHistory {
  return {
    id: 'history-1',
    pageId: 'page-1',
    title: 'Title',
    slug: null,
    icon: null,
    coverPhoto: null,
    version: null,
    lastUpdatedById: 'user-1',
    workspaceId: 'ws-1',
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    lastUpdatedBy: {
      id: 'user-1',
      name: 'User',
      avatarUrl: null,
    },
    ...overrides,
  } as IPageHistory;
}

describe('formatHistorySummary', () => {
  it('formats custom fields changes', () => {
    const summary = formatHistorySummary(
      createHistoryItem({
        changeType: 'page.custom-fields.updated',
        changeData: {
          changes: [
            { field: 'status', oldValue: 'TODO', newValue: 'DONE' },
            { field: 'assigneeId', oldValue: null, newValue: 'user-2' },
          ],
        },
      }),
      t,
    );

    expect(summary).toContain('history.event.field.changed');
    expect(summary).toContain('TODO');
    expect(summary).toContain('DONE');
  });

  it('formats database property update details', () => {
    const summary = formatHistorySummary(
      createHistoryItem({
        changeType: 'database.property.updated',
        changeData: {
          property: { name: 'Status' },
          changes: [{ field: 'name', oldValue: 'State', newValue: 'Status' }],
        },
      }),
      t,
    );

    expect(summary).toContain('history.event.database.property.updated.with-details');
    expect(summary).toContain('Status');
  });

  it('formats conversion events', () => {
    const summary = formatHistorySummary(
      createHistoryItem({
        changeType: 'database.converted.to-page',
      }),
      t,
    );

    expect(summary).toContain('history.event.conversion.database-to-page');
  });
});
