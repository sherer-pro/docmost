import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { resolveDatabasePageContext } from './database-page-context';

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

