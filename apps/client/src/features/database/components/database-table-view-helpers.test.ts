import { describe, expect, it } from 'vitest';
import {
  DATABASE_PROPERTY_DRAG_MIME,
  getCheckboxFilterOptions,
  getSelectedPreparedRowIds,
  isDatabaseFilterControlsVisible,
  isSameCellPayloadValue,
  mergePinnedDatabaseRow,
  normalizeDatabaseViewConfig,
  reorderDatabaseProperties,
  resolveDraggedDatabasePropertyId,
  resolveDatabasePropertyRename,
  shouldHandleDatabaseMatrixPaste,
  shouldShowDatabaseFilterRemove,
  shouldDeleteCellPayload,
} from './database-table-view.helpers';

describe('database-table-view helpers', () => {
  it('hides filter controls on mobile while keeping state applicability intact', () => {
    expect(isDatabaseFilterControlsVisible(true)).toBe(false);
    expect(isDatabaseFilterControlsVisible(false)).toBe(true);
  });

  it('shows filter removal only when another condition can remain', () => {
    expect(shouldShowDatabaseFilterRemove(0)).toBe(false);
    expect(shouldShowDatabaseFilterRemove(1)).toBe(false);
    expect(shouldShowDatabaseFilterRemove(2)).toBe(true);
  });

  it('keeps multiline paste inside active text and code editors', () => {
    expect(
      shouldHandleDatabaseMatrixPaste('first\nsecond', true, 'multiline_text'),
    ).toBe(false);
    expect(shouldHandleDatabaseMatrixPaste('first\nsecond', true, 'code')).toBe(
      false,
    );
    expect(
      shouldHandleDatabaseMatrixPaste('first\nsecond', false, 'code'),
    ).toBe(true);
    expect(
      shouldHandleDatabaseMatrixPaste('first\tsecond', true, 'select'),
    ).toBe(true);
  });

  it('pins a newly created row first without duplicating canonical data', () => {
    const rows = [
      { id: 'row-1', pageId: 'page-1' },
      { id: 'row-2', pageId: 'page-2' },
    ];
    const pinnedRow = {
      id: 'row-2',
      pageId: 'page-2',
      pageTitle: 'New row',
    };

    expect(mergePinnedDatabaseRow(rows, pinnedRow)).toEqual([pinnedRow, rows[0]]);
    expect(mergePinnedDatabaseRow(rows, null)).toBe(rows);
  });

  it('reorders database properties and normalizes their positions', () => {
    const properties = [
      { id: 'property-a', position: 0 },
      { id: 'property-b', position: 1 },
      { id: 'property-c', position: 2 },
    ];

    expect(reorderDatabaseProperties(properties, 'property-c', 'property-a')).toEqual([
      { id: 'property-c', position: 0 },
      { id: 'property-a', position: 1 },
      { id: 'property-b', position: 2 },
    ]);
    expect(reorderDatabaseProperties(properties, 'property-a', 'missing-property')).toBe(
      properties,
    );
  });

  it('resolves dragged property from synchronous state and compatible transfer data', () => {
    const transferredValues: Record<string, string> = {
      [DATABASE_PROPERTY_DRAG_MIME]: 'property-custom',
      'text/plain': 'property-plain',
    };
    const dataTransfer = {
      getData: (format: string) => transferredValues[format] ?? '',
    };

    expect(resolveDraggedDatabasePropertyId('property-active', dataTransfer)).toBe(
      'property-active',
    );
    expect(resolveDraggedDatabasePropertyId(null, dataTransfer)).toBe('property-custom');

    delete transferredValues[DATABASE_PROPERTY_DRAG_MIME];
    expect(resolveDraggedDatabasePropertyId(null, dataTransfer)).toBe('property-plain');
  });

  it('normalizes inline property rename payload', () => {
    expect(resolveDatabasePropertyRename('Status', '  Owner  ')).toBe('Owner');
    expect(resolveDatabasePropertyRename('Status', 'Status')).toBeNull();
    expect(resolveDatabasePropertyRename('Status', '   ')).toBeNull();
  });

  it('computes delete semantics for database cell payloads', () => {
    expect(shouldDeleteCellPayload('multiline_text', '')).toBe(true);
    expect(shouldDeleteCellPayload('multiline_text', null)).toBe(true);
    expect(shouldDeleteCellPayload('user', { id: '' })).toBe(true);
    expect(shouldDeleteCellPayload('checkbox', false)).toBe(false);
  });

  it('returns typed checkbox filter options', () => {
    const t = (key: string) => key;
    expect(getCheckboxFilterOptions(t)).toEqual([
      { value: 'true', label: 'Checked' },
      { value: 'false', label: 'Unchecked' },
    ]);
  });

  it('compares payload values for no-op save protection', () => {
    expect(isSameCellPayloadValue('x', 'x')).toBe(true);
    expect(isSameCellPayloadValue({ id: 'u-1' }, { id: 'u-1' })).toBe(true);
    expect(isSameCellPayloadValue({ id: 'u-1' }, { id: 'u-2' })).toBe(false);
  });

  it('returns selected ids only for currently prepared rows', () => {
    const selectedRowPageIds = {
      'page-visible-1': true,
      'page-visible-2': true,
      'page-hidden-1': true,
      'page-visible-3': false,
    };
    const preparedRows = [
      { pageId: 'page-visible-1' },
      { pageId: 'page-visible-2' },
      { pageId: 'page-visible-3' },
    ];

    expect(getSelectedPreparedRowIds(selectedRowPageIds, preparedRows)).toEqual([
      'page-visible-1',
      'page-visible-2',
    ]);
  });

  it('normalizes saved view configuration against active properties', () => {
    expect(
      normalizeDatabaseViewConfig(
        {
          filters: [
            { propertyId: 'property-a', operator: 'contains', value: 'keep' },
            { propertyId: 'missing', operator: 'equals', value: 'drop' },
          ],
          sortState: { propertyId: 'property-b', direction: 'desc' },
          visibleColumns: {
            'property-a': false,
            'property-b': true,
            missing: false,
          },
        },
        ['property-a', 'property-b'],
      ),
    ).toEqual({
      filters: [{ propertyId: 'property-a', operator: 'contains', value: 'keep' }],
      sortState: { propertyId: 'property-b', direction: 'desc' },
      visibleColumns: { 'property-a': false, 'property-b': true },
    });
  });
});
