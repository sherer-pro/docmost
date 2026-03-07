import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { IDatabaseProperty } from '../types/database.types';
import {
  buildDatabaseCellPayloadValue,
  getDatabaseCellDisplayValue,
  normalizeDatabaseCheckboxValue,
  normalizeDatabasePageReferenceValue,
  normalizeDatabaseSelectValue,
  normalizeDatabaseStringValue,
  normalizeDatabaseUserId,
} from './database-cell-value';

function createProperty(partial: Partial<IDatabaseProperty>): IDatabaseProperty {
  return {
    id: 'property-id',
    databaseId: 'database-id',
    workspaceId: 'workspace-id',
    name: 'Property',
    type: 'multiline_text',
    position: 0,
    settings: {},
    creatorId: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    ...partial,
  };
}

describe('database-cell-value normalization', () => {
  it('normalizes user values from string/object/null and builds contract payload', () => {
    const userProperty = createProperty({ type: 'user' });

    assert.equal(normalizeDatabaseUserId('user-1'), 'user-1');
    assert.equal(normalizeDatabaseUserId({ id: 'user-2' }), 'user-2');
    assert.equal(normalizeDatabaseUserId('{"id":"user-5"}'), 'user-5');
    assert.equal(normalizeDatabaseUserId(JSON.stringify('{"id":"user-6"}')), 'user-6');
    assert.equal(normalizeDatabaseUserId(null), null);

    assert.deepEqual(buildDatabaseCellPayloadValue(userProperty, 'user-3'), { id: 'user-3' });
    assert.deepEqual(buildDatabaseCellPayloadValue(userProperty, { id: 'user-4' }), { id: 'user-4' });
    assert.equal(buildDatabaseCellPayloadValue(userProperty, null), null);
  });

  it('normalizes select values from fallback-object and keeps label fallback for deleted options', () => {
    const selectProperty = createProperty({
      type: 'select',
      settings: {
        options: [{ label: 'In progress', value: 'in_progress', color: 'blue' }],
      },
    });

    assert.equal(normalizeDatabaseSelectValue('in_progress'), 'in_progress');
    assert.equal(
      normalizeDatabaseSelectValue({
        value: 'in_progress',
        rawValueBeforeTypeChange: { id: 'legacy' },
        rawTypeBeforeTypeChange: 'user',
      }),
      'in_progress',
    );
    assert.equal(normalizeDatabaseSelectValue('"in_progress"'), 'in_progress');

    assert.equal(
      getDatabaseCellDisplayValue({ property: selectProperty, value: 'in_progress' }),
      'In progress',
    );
    assert.equal(
      getDatabaseCellDisplayValue({ property: selectProperty, value: '"in_progress"' }),
      'In progress',
    );
    assert.equal(
      getDatabaseCellDisplayValue({ property: selectProperty, value: 'deleted_option' }),
      'deleted_option',
    );
  });

  it('normalizes page_reference from fallback-object and resolves page title when available', () => {
    const pageReferenceProperty = createProperty({ type: 'page_reference' });

    const fallbackValue = {
      value: 'page-1',
      rawValueBeforeTypeChange: { value: 'legacy' },
      rawTypeBeforeTypeChange: 'multiline_text',
    };

    assert.equal(normalizeDatabasePageReferenceValue(fallbackValue), 'page-1');
    assert.equal(normalizeDatabasePageReferenceValue('"page-1"'), 'page-1');
    assert.equal(
      getDatabaseCellDisplayValue({
        property: pageReferenceProperty,
        value: fallbackValue,
        pageTitleById: { 'page-1': 'Sprint planning' },
      }),
      'Sprint planning',
    );
    assert.equal(
      getDatabaseCellDisplayValue({ property: pageReferenceProperty, value: 'page-2' }),
      'page-2',
    );
  });


  it('normalizes checkbox values from booleans and legacy strings', () => {
    const checkboxProperty = createProperty({ type: 'checkbox' });

    assert.equal(normalizeDatabaseCheckboxValue(true), true);
    assert.equal(normalizeDatabaseCheckboxValue(false), false);
    assert.equal(normalizeDatabaseCheckboxValue('true'), true);
    assert.equal(normalizeDatabaseCheckboxValue('false'), false);
    assert.equal(normalizeDatabaseCheckboxValue('"false"'), false);
    assert.equal(buildDatabaseCellPayloadValue(checkboxProperty, 'false'), false);
    assert.equal(
      getDatabaseCellDisplayValue({ property: checkboxProperty, value: 'false' }),
      'false',
    );
  });

  it('unwraps repeatedly serialized text values and preserves line breaks', () => {
    const textProperty = createProperty({ type: 'multiline_text' });
    const initialValue = 'xasww\nline 2';
    const serializedTwice = JSON.stringify(JSON.stringify(initialValue));

    assert.equal(normalizeDatabaseStringValue(serializedTwice), initialValue);
    assert.equal(buildDatabaseCellPayloadValue(textProperty, serializedTwice), initialValue);
    assert.equal(
      getDatabaseCellDisplayValue({ property: textProperty, value: serializedTwice }),
      initialValue,
    );
  });
});


