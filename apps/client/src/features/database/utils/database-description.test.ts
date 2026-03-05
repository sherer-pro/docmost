import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  serializeDatabaseDescription,
  toDatabaseDescriptionDoc,
} from './database-description';

describe('database description page-content contract', () => {
  it('keeps edited description after serialization and reload from page content', () => {
    const updatedDescription = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Database description after edit' }],
        },
      ],
    };

    const persistedContent = serializeDatabaseDescription(updatedDescription);
    const restoredDescription = toDatabaseDescriptionDoc(persistedContent);

    assert.deepEqual(restoredDescription, updatedDescription);
  });

  it('preserves inline comment markers in page content payload', () => {
    const withCommentMarker = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Commented text',
              marks: [
                {
                  type: 'annotation',
                  attrs: {
                    commentId: 'comment-1',
                    quoteId: 'page-1:quote-1',
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const persistedContent = serializeDatabaseDescription(withCommentMarker);
    const restoredDescription = toDatabaseDescriptionDoc(persistedContent);

    assert.deepEqual(restoredDescription, withCommentMarker);
  });
});
