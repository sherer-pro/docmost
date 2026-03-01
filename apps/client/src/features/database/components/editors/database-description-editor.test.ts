import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDatabaseDescriptionSlashItems } from './database-description-slash-items';

const flattenTitles = (groups: ReturnType<typeof getDatabaseDescriptionSlashItems>) => {
  return Object.values(groups).flatMap((items) => items.map((item) => item.title));
};

describe('DatabaseDescriptionEditor slash commands', () => {
  it('keeps lightweight formatting commands so menu can open on "/"', () => {
    const items = getDatabaseDescriptionSlashItems({ query: '' });
    const titles = flattenTitles(items);

    assert.equal(titles.includes('Heading 1'), true);
    assert.equal(titles.includes('Bullet list'), true);
    assert.equal(titles.includes('Numbered list'), true);
    assert.equal(titles.includes('Divider'), true);
    assert.equal(titles.length > 0, true);
  });

  it('filters out heavy slash commands in database description context', () => {
    const items = getDatabaseDescriptionSlashItems({ query: '' });
    const titles = flattenTitles(items);

    assert.equal(titles.includes('Image'), false);
    assert.equal(titles.includes('Video'), false);
    assert.equal(titles.includes('Table'), false);
    assert.equal(titles.includes('Embed'), false);
  });
});
