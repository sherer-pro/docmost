import {
  createPageEmbedAttachmentCloneStorageFromEnvironment,
  pageEmbedAttachmentCloneId,
  rewriteMaterializedAttachmentReferences,
} from './page-embed-attachment-clones';
import { S3Driver } from '../integrations/storage/drivers';

const CONSUMER_ID = '30000000-0000-4000-8000-000000000001';
const IMAGE_ID = '30000000-0000-4000-8000-000000000002';
const FILE_ID = '30000000-0000-4000-8000-000000000003';

describe('pageEmbed attachment clone contract', () => {
  it('uses a stable per-consumer attachment id', () => {
    expect(pageEmbedAttachmentCloneId(CONSUMER_ID, IMAGE_ID)).toBe(
      pageEmbedAttachmentCloneId(CONSUMER_ID, IMAGE_ID),
    );
    expect(pageEmbedAttachmentCloneId(CONSUMER_ID, IMAGE_ID)).not.toBe(
      pageEmbedAttachmentCloneId(CONSUMER_ID, FILE_ID),
    );
    expect(pageEmbedAttachmentCloneId(CONSUMER_ID, IMAGE_ID)).not.toBe(
      pageEmbedAttachmentCloneId(
        '30000000-0000-4000-8000-000000000099',
        IMAGE_ID,
      ),
    );
  });

  it('rewrites owned image and file references without mutating other text', () => {
    const copiedImageId = pageEmbedAttachmentCloneId(CONSUMER_ID, IMAGE_ID);
    const copiedFileId = pageEmbedAttachmentCloneId(CONSUMER_ID, FILE_ID);
    const source = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            attachmentId: IMAGE_ID,
            src: `/api/attachments/files/${IMAGE_ID}/source.png`,
          },
        },
        {
          type: 'attachment',
          attrs: {
            attachmentId: FILE_ID,
            url: `https://docs.example/api/files/public/${FILE_ID}/source.pdf`,
          },
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `keep ${IMAGE_ID} as text` }],
        },
      ],
    };

    const rewritten = rewriteMaterializedAttachmentReferences(
      source,
      new Map([
        [IMAGE_ID, copiedImageId],
        [FILE_ID, copiedFileId],
      ]),
    ) as any;

    expect(rewritten.content[0].attrs).toEqual({
      attachmentId: copiedImageId,
      src: `/api/attachments/files/${copiedImageId}/source.png`,
    });
    expect(rewritten.content[1].attrs).toEqual({
      attachmentId: copiedFileId,
      url: `https://docs.example/api/files/public/${copiedFileId}/source.pdf`,
    });
    expect(rewritten.content[2].content[0].text).toBe(
      `keep ${IMAGE_ID} as text`,
    );
    expect(source.content[0].attrs.attachmentId).toBe(IMAGE_ID);
  });

  it('supports the standard AWS endpoint when no custom endpoint is configured', async () => {
    const names = [
      'STORAGE_DRIVER',
      'AWS_S3_REGION',
      'AWS_S3_BUCKET',
      'AWS_S3_ENDPOINT',
      'AWS_S3_URL',
      'AWS_S3_ACCESS_KEY_ID',
      'AWS_S3_SECRET_ACCESS_KEY',
    ] as const;
    const previous = new Map(names.map((name) => [name, process.env[name]]));
    try {
      process.env.STORAGE_DRIVER = 's3';
      process.env.AWS_S3_REGION = 'eu-central-1';
      process.env.AWS_S3_BUCKET = 'docmost-test';
      delete process.env.AWS_S3_ENDPOINT;
      delete process.env.AWS_S3_URL;
      delete process.env.AWS_S3_ACCESS_KEY_ID;
      delete process.env.AWS_S3_SECRET_ACCESS_KEY;

      const created = createPageEmbedAttachmentCloneStorageFromEnvironment();
      expect(created.storage).toBeInstanceOf(S3Driver);
      expect(
        (created.storage as S3Driver).getConfig().endpoint,
      ).toBeUndefined();
      await created.close();
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
