import { describe, expect, it } from 'vitest';
import {
  isDatabaseFilterControlsVisible,
  isSameCellPayloadValue,
  resolveDatabasePropertyRename,
  shouldDeleteCellPayload,
} from './database-table-view.helpers';

describe('database-table-view helpers', () => {
  it('hides filter controls on mobile while keeping state applicability intact', () => {
    expect(isDatabaseFilterControlsVisible(true)).toBe(false);
    expect(isDatabaseFilterControlsVisible(false)).toBe(true);
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

  it('compares payload values for no-op save protection', () => {
    expect(isSameCellPayloadValue('x', 'x')).toBe(true);
    expect(isSameCellPayloadValue({ id: 'u-1' }, { id: 'u-1' })).toBe(true);
    expect(isSameCellPayloadValue({ id: 'u-1' }, { id: 'u-2' })).toBe(false);
  });
});
