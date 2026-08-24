import {
  DATABASE_PROJECTION_BATCH_SIZE,
  DatabaseSearchProjectionService,
} from './database-search-projection.service';
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

  it('reads a workspace through bounded cursor pages', async () => {
    const rows = Array.from({ length: 1_005 }, (_, index) => ({
      pageId: `page-${String(index).padStart(4, '0')}`,
      workspaceId: index < 503 ? 'workspace-a' : 'workspace-b',
    }));
    const batches = Array.from(
      { length: Math.ceil(rows.length / DATABASE_PROJECTION_BATCH_SIZE) },
      (_, index) =>
        rows.slice(
          index * DATABASE_PROJECTION_BATCH_SIZE,
          (index + 1) * DATABASE_PROJECTION_BATCH_SIZE,
        ),
    );
    batches.push([]);
    const execute = jest.fn().mockImplementation(async () => batches.shift());
    const query: any = {
      innerJoin: jest.fn(() => query),
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      orderBy: jest.fn(() => query),
      limit: jest.fn(() => query),
      execute,
    };
    const db = { selectFrom: jest.fn(() => query) } as any;
    const service = new DatabaseSearchProjectionService(db);
    const refreshPages = jest
      .spyOn(service, 'refreshPages')
      .mockResolvedValue(undefined);

    const pageIds = await service.refreshWorkspace();

    expect(pageIds).toHaveLength(rows.length);
    expect(execute).toHaveBeenCalledTimes(11);
    expect(refreshPages).toHaveBeenCalled();
    for (const [batch] of refreshPages.mock.calls) {
      expect(batch.length).toBeLessThanOrEqual(DATABASE_PROJECTION_BATCH_SIZE);
    }
    expect(query.where).toHaveBeenCalledWith(expect.any(Function));
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
