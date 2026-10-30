import { pageAttachmentUsages } from './page-attachment-usages';

describe('pageAttachmentUsages', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('canonicalizes UUID references before matching attachment metadata', () => {
    const upper = 'ABCDEFAB-1234-4234-8234-ABCDEFABCDEF';
    expect(
      pageAttachmentUsages({
        content: [{ attrs: { attachmentId: upper } }],
      }).get(upper.toLowerCase()),
    ).toEqual(['']);
  });
  it('retains all references, including nodes without a navigation target', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'paragraph' },
          content: [{ type: 'attachment', attrs: { attachmentId: id } }],
        },
        { type: 'image', attrs: { attachmentId: id } },
        { type: 'image', attrs: { attachmentId: 'not-an-id' } },
      ],
    };
    expect(pageAttachmentUsages(JSON.stringify(doc)).get(id)?.sort()).toEqual([
      '',
      'paragraph',
    ]);
    expect(pageAttachmentUsages(doc).size).toBe(1);
  });
  it.each([null, 'invalid json', { content: 'not an array' }])(
    'handles incomplete content %p',
    (doc) => {
      expect(pageAttachmentUsages(doc).size).toBe(0);
    },
  );
});
