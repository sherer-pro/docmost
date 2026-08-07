import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  findDatabaseIdByPageRoute,
  resolveDatabasePageContext,
} from './database-page-context';

describe('resolveDatabasePageContext', () => {
  it('uses database.pageId when database entity is loaded before page-by-slug', () => {
    const context = resolveDatabasePageContext({
      databaseSlug: 'project-tracker-a1b2c3',
      spaceSlug: 'engineering',
      database: {
        id: 'db-1',
        pageId: 'page-from-database',
        pageSlugId: 'slug-from-database',
      } as never,
      pageByRoute: undefined,
    });

    assert.equal(context.databaseId, 'db-1');
    assert.equal(context.databasePageId, 'page-from-database');
    assert.equal(context.databasePageSlugId, 'slug-from-database');
    assert.equal(context.spaceSlug, 'engineering');
  });

  it('falls back to route/page ids when database entity is not loaded yet', () => {
    const context = resolveDatabasePageContext({
      databaseSlug: 'project-tracker-a1b2c3',
      pageByRoute: {
        id: 'page-from-route',
        slugId: 'a1b2c3',
        databaseId: 'db-from-route',
      } as never,
    });

    assert.equal(context.databaseId, 'db-from-route');
    assert.equal(context.databasePageId, 'page-from-route');
    assert.equal(context.databasePageSlugId, 'a1b2c3');
  });
});

describe('findDatabaseIdByPageRoute', () => {
  it('resolves a nested database by its canonical page slug', () => {
    const databaseId = findDatabaseIdByPageRoute(
      [
        {
          id: 'parent-page',
          nodeType: 'page',
          slugId: 'parent-slug',
          databaseId: null,
          name: 'Parent',
          position: 'a0',
          spaceId: 'space-1',
          parentPageId: null,
          hasChildren: true,
          children: [
            {
              id: 'database-page',
              nodeType: 'database',
              slugId: 'database-slug',
              databaseId: 'database-1',
              name: 'Database',
              position: 'a1',
              spaceId: 'space-1',
              parentPageId: 'parent-page',
              hasChildren: false,
              children: [],
            },
          ],
        },
      ],
      'database-slug',
    );

    assert.equal(databaseId, 'database-1');
  });
});

