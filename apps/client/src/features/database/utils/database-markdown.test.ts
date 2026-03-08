import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  buildDatabaseMarkdownFromState,
  IDatabaseTableExportState,
  prepareDatabaseRowsForExport,
} from './database-markdown';
import { IDatabaseRowWithCells } from '@/features/database/types/database-table.types';

const properties = [
  {
    id: 'prop-status',
    name: 'Status',
  },
] as any;

const rows: IDatabaseRowWithCells[] = [
  {
    id: 'row-2',
    pageId: 'page-2',
    pageTitle: 'B title',
    cells: [
      {
        id: 'cell-2',
        pageId: 'page-2',
        propertyId: 'prop-status',
        value: 'zeta',
      },
    ],
  },
  {
    id: 'row-1',
    pageId: 'page-1',
    pageTitle: 'A title',
    cells: [
      {
        id: 'cell-1',
        pageId: 'page-1',
        propertyId: 'prop-status',
        value: 'alpha',
      },
    ],
  },
];

describe('database markdown export helpers', () => {
  it('applies filter and sorting when preparing rows', () => {
    const state: IDatabaseTableExportState = {
      visibleColumns: {},
      filters: [
        {
          propertyId: 'prop-status',
          operator: 'contains',
          value: 'a',
        },
      ],
      sortState: {
        propertyId: 'prop-status',
        direction: 'asc',
      },
    };

    const preparedRows = prepareDatabaseRowsForExport(rows, state);
    assert.deepEqual(
      preparedRows.map((row) => row.pageId),
      ['page-1', 'page-2'],
    );
  });

  it('skips local filter/sort when rows are already fetched by table query params', () => {
    const state: IDatabaseTableExportState = {
      visibleColumns: {},
      filters: [
        {
          propertyId: 'prop-status',
          operator: 'contains',
          value: 'alpha',
        },
      ],
      sortState: {
        propertyId: 'prop-status',
        direction: 'asc',
      },
      rowsQueryParams: {
        sortPropertyId: 'prop-status',
        sortDirection: 'asc',
      },
    };

    const markdown = buildDatabaseMarkdownFromState({
      title: 'Database',
      properties,
      rows,
      state,
      untitledLabel: 'Untitled',
      skipFilterAndSort: true,
    });

    const firstRowIndex = markdown.indexOf('| B title | zeta |');
    const secondRowIndex = markdown.indexOf('| A title | alpha |');
    assert.ok(firstRowIndex >= 0);
    assert.ok(secondRowIndex >= 0);
    assert.ok(firstRowIndex < secondRowIndex);
  });
});
