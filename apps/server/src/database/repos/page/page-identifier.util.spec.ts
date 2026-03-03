import {
  getPageIdentifierColumn,
  resolveCanonicalPageId,
  resolveCanonicalPageDatabaseIdentifiers,
  splitPageIdentifiers,
} from './page-identifier.util';

describe('page identifier utilities', () => {
  it('supports UUID-only identifiers', async () => {
    const id = '0d75095b-cd06-43bc-9855-7956ec83f4fb';

    expect(getPageIdentifierColumn(id)).toBe('id');
    expect(splitPageIdentifiers([id])).toEqual({ uuidIds: [id], slugIds: [] });
    await expect(
      resolveCanonicalPageId(id, async () => null),
    ).resolves.toBe(id);
  });

  it('supports slugId-only identifiers', async () => {
    const slugId = 'docs-home';

    expect(getPageIdentifierColumn(slugId)).toBe('slugId');
    expect(splitPageIdentifiers([slugId])).toEqual({
      uuidIds: [],
      slugIds: [slugId],
    });
    await expect(
      resolveCanonicalPageId(slugId, async (value) =>
        value === slugId ? 'page-uuid-1' : null,
      ),
    ).resolves.toBe('page-uuid-1');
  });

  it('supports mixed UUID + slugId identifiers', () => {
    const uuid = '0d75095b-cd06-43bc-9855-7956ec83f4fb';
    const slugId = 'docs-home';

    expect(splitPageIdentifiers([uuid, slugId])).toEqual({
      uuidIds: [uuid],
      slugIds: [slugId],
    });
  });

  it('builds UUID-only page/database contract', () => {
    expect(
      resolveCanonicalPageDatabaseIdentifiers({
        pageId: '0d75095b-cd06-43bc-9855-7956ec83f4fb',
        databaseId: 'db-1',
      }),
    ).toEqual({
      apiPageId: '0d75095b-cd06-43bc-9855-7956ec83f4fb',
      routeSlugId: undefined,
      apiDatabaseId: 'db-1',
    });
  });

  it('builds slugId-only page/database contract', () => {
    expect(
      resolveCanonicalPageDatabaseIdentifiers({
        slugId: 'docs-home',
        databaseId: 'db-2',
      }),
    ).toEqual({
      apiPageId: undefined,
      routeSlugId: 'docs-home',
      apiDatabaseId: 'db-2',
    });
  });

  it('builds mixed page/database contract', () => {
    expect(
      resolveCanonicalPageDatabaseIdentifiers({
        pageId: '0d75095b-cd06-43bc-9855-7956ec83f4fb',
        slugId: 'docs-home',
        databaseId: 'db-3',
      }),
    ).toEqual({
      apiPageId: '0d75095b-cd06-43bc-9855-7956ec83f4fb',
      routeSlugId: 'docs-home',
      apiDatabaseId: 'db-3',
    });
  });
});
