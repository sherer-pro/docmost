import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import getSuggestionItems from '@/features/editor/components/slash-menu/menu-items';
import { getDatabaseDescriptionSlashItems } from './database-description-slash-items';

const flattenTitles = (groups: ReturnType<typeof getDatabaseDescriptionSlashItems>) => {
  return Object.values(groups).flatMap((items) => items.map((item) => item.title));
};

describe('DatabaseDescriptionEditor slash commands', () => {
  it('returns the same slash command groups as the page editor menu', () => {
    const query = '';
    const databaseItems = getDatabaseDescriptionSlashItems({ query });
    const pageItems = getSuggestionItems({ query });

    assert.deepEqual(databaseItems, pageItems);
  });

  it('keeps media and embed commands that were previously filtered out', () => {
    const items = getDatabaseDescriptionSlashItems({ query: '' });
    const titles = flattenTitles(items);

    assert.equal(titles.includes('Image'), true);
    assert.equal(titles.includes('Video'), true);
    assert.equal(titles.includes('Table'), true);
    assert.equal(titles.includes('Embed'), true);
  });
});
