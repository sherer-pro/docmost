import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import getSuggestionItems from '@/features/editor/components/slash-menu/menu-items';
import { getDatabaseDescriptionSlashItems } from './database-description-slash-items';

const flattenTitles = (groups: ReturnType<typeof getDatabaseDescriptionSlashItems>) => {
  return Object.values(groups).flatMap((items) => items.map((item) => item.title));
};

describe('DatabaseDescriptionEditor slash commands', () => {
  it('matches page editor slash commands for empty query', () => {
    const query = '';
    const databaseTitles = flattenTitles(getDatabaseDescriptionSlashItems({ query }));
    const pageTitles = flattenTitles(getSuggestionItems({ query }));

    assert.deepEqual(databaseTitles, pageTitles);
  });

  it('matches page editor slash commands for filtered query', () => {
    const query = 'table';
    const databaseTitles = flattenTitles(getDatabaseDescriptionSlashItems({ query }));
    const pageTitles = flattenTitles(getSuggestionItems({ query }));

    assert.deepEqual(databaseTitles, pageTitles);
  });
});
