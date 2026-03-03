import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import getSuggestionItems from '@/features/editor/components/slash-menu/menu-items';
import { getDatabaseDescriptionSlashItems } from './database-description-slash-items';

const flattenTitles = (groups: ReturnType<typeof getDatabaseDescriptionSlashItems>) => {
  return Object.values(groups).flatMap((items) => items.map((item) => item.title));
};

describe('DatabaseDescriptionEditor slash commands', () => {
  it('returns only slash commands supported by lightweight description UI', () => {
    const query = '';
    const databaseItems = getDatabaseDescriptionSlashItems({ query });
    const pageItems = getSuggestionItems({ query });
    const databaseTitles = new Set(flattenTitles(databaseItems));
    const pageTitles = flattenTitles(pageItems);

    assert.equal(pageTitles.length > databaseTitles.size, true);
    assert.equal(databaseTitles.has('Text'), true);
    assert.equal(databaseTitles.has('Table'), true);
    assert.equal(databaseTitles.has('Image'), false);
    assert.equal(databaseTitles.has('Video'), false);
    assert.equal(databaseTitles.has('Iframe embed'), false);
  });

  it('keeps table command for editable descriptions', () => {
    const items = getDatabaseDescriptionSlashItems({ query: '' });
    const titles = flattenTitles(items);

    assert.equal(titles.includes('Table'), true);
  });
});
