import { describe, expect, it } from 'vitest';
import { sortDatabasePropertiesByPosition } from './database-property-order';

describe('database property order', () => {
  it('sorts row-page fields by their canonical property position', () => {
    const properties = [
      { id: 'property-c', position: 2 },
      { id: 'property-a', position: 0 },
      { id: 'property-b', position: 1 },
    ];

    expect(sortDatabasePropertiesByPosition(properties)).toEqual([
      { id: 'property-a', position: 0 },
      { id: 'property-b', position: 1 },
      { id: 'property-c', position: 2 },
    ]);
    expect(properties.map((property) => property.id)).toEqual([
      'property-c',
      'property-a',
      'property-b',
    ]);
  });
});
