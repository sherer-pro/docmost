import { DatabaseSearchProjectionService } from './database-search-projection.service';
import { randomUUID } from 'node:crypto';

describe('DatabaseSearchProjectionService', () => {
  const service = new DatabaseSearchProjectionService({} as any);

  it('projects only safe display values and select labels', async () => {
    const projections = await (service as any).buildCellProjections(
      [
        cell('text', 'multiline_text', 'Visible text'),
        cell('code', 'code', 'const value = 1;'),
        cell('select', 'select', 'in-progress', {
          options: [{ value: 'in-progress', label: 'In progress' }],
        }),
        cell('checkbox', 'checkbox', true),
        cell('reference', 'page_reference', { id: randomUUID() }),
        cell('uuid', 'multiline_text', randomUUID()),
        cell('uuid-v7', 'code', '01912345-6789-7abc-8def-0123456789ab'),
        cell('json', 'code', '{"secret":true}'),
      ],
      'workspace-1',
    );

    expect(projections.get('page-1').map((item: any) => item.value)).toEqual([
      'Visible text',
      'const value = 1;',
      'In progress',
    ]);
  });

  it('uses the current user display name instead of the stored UUID', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    expect(
      (service as any).toDisplayValue(
        cell('owner', 'user', userId),
        new Map([[userId, 'Ada Lovelace']]),
      ),
    ).toBe('Ada Lovelace');
  });

  it('limits one cell to 20 KB and the whole row to 1 MB', () => {
    expect(
      (service as any).truncateUtf8('я'.repeat(20_000), 20_000),
    ).toHaveLength(10_000);
    const projected = (service as any).joinProjectionValues([
      { value: 'a'.repeat(750_000) },
      { value: 'b'.repeat(750_000) },
    ]);
    expect(Buffer.byteLength(projected, 'utf8')).toBe(1_000_000);
  });

  it('returns a safe property-labelled snippet with diacritic positions', () => {
    expect(
      (service as any).buildMatch(
        {
          propertyId: 'property-1',
          propertyName: 'Customer',
          value: 'Café Society',
        },
        'cafe',
      ),
    ).toEqual({
      propertyId: 'property-1',
      propertyName: 'Customer',
      text: 'Café Society',
      matches: [{ start: 0, end: 4, value: 'Café' }],
    });
  });
});

function cell(
  propertyId: string,
  propertyType: string,
  value: unknown,
  propertySettings: unknown = {},
) {
  return {
    pageId: 'page-1',
    propertyId,
    propertyName: propertyId,
    propertyType,
    propertySettings,
    propertyPosition: 0,
    value,
  };
}
