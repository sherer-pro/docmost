import { TiptapTransformer } from '@hocuspocus/transformer';
import { Node } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import * as Y from 'yjs';
import { pageEmbedAttachmentCloneId } from './page-embed-attachment-clones';
import {
  containsPageEmbed,
  decodePageYdoc,
  materializePageEmbeds,
  neutralizePageEmbeds,
  parsePageEmbedRemovalInvocation,
  type PageMaterializationContext,
  type PageRow,
} from './page-embed-removal';

const CONSUMER_ID = '10000000-0000-4000-8000-000000000001';
const SOURCE_ID = '10000000-0000-4000-8000-000000000002';
const ATTACHMENT_ID = '10000000-0000-4000-8000-000000000003';

const LegacyPageEmbed = Node.create({
  name: 'pageEmbed',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      id: { default: null },
      sourcePageId: { default: null },
    };
  },
});

function row(id: string, content: unknown, spaceId = 'space-1'): PageRow {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId,
    parentPageId: null,
    deletedAt: null,
    content,
    ydoc: null,
    authoritativeContent: content,
  };
}

function context(
  consumer: PageRow,
  source?: PageRow,
): PageMaterializationContext {
  const pages = new Map([[consumer.id, consumer]]);
  if (source) pages.set(source.id, source);
  return {
    dirtyPages: [consumer],
    pages,
    accessRulePageIds: new Set(),
    sharesByPageId: new Map(),
    attachments: new Map(),
    limitExceeded: false,
  };
}

function legacyNode() {
  return {
    type: 'pageEmbed',
    attrs: { id: 'legacy-reference', sourcePageId: SOURCE_ID },
  };
}

describe('pageEmbed pre-upgrade cleanup', () => {
  it('distinguishes ordinary pageEmbed text from a semantic legacy node in Ydoc', () => {
    const plainYdoc = TiptapTransformer.toYdoc(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'plain pageEmbed text' }],
          },
        ],
      },
      'default',
      [StarterKit],
    );
    const plainBuffer = Buffer.from(Y.encodeStateAsUpdate(plainYdoc));
    expect(plainBuffer.includes(Buffer.from('pageEmbed'))).toBe(true);
    const plain = decodePageYdoc({
      ...row(CONSUMER_ID, null),
      ydoc: plainBuffer,
    });
    expect(plain.ydocDecodeError).toBe(false);
    expect(containsPageEmbed(plain.ydocContent)).toBe(false);

    const legacyYdoc = TiptapTransformer.toYdoc(
      { type: 'doc', content: [legacyNode()] },
      'default',
      [StarterKit, LegacyPageEmbed],
    );
    const legacy = decodePageYdoc({
      ...row(CONSUMER_ID, null),
      ydoc: Buffer.from(Y.encodeStateAsUpdate(legacyYdoc)),
    });
    expect(legacy.ydocDecodeError).toBe(false);
    expect(containsPageEmbed(legacy.ydocContent)).toBe(true);

    plainYdoc.destroy();
    legacyYdoc.destroy();
  });

  it('materializes only attachment-free sources with compatible audience', () => {
    const consumer = row(CONSUMER_ID, {
      type: 'doc',
      content: [legacyNode()],
    });
    const source = row(SOURCE_ID, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'source' }],
        },
      ],
    });
    const result = materializePageEmbeds(
      consumer,
      context(consumer, source),
      'block',
    );

    expect(containsPageEmbed(result.value)).toBe(false);
    expect(result.report.materializable).toBe(1);
    expect(result.report.blocked).toEqual([]);
  });

  it('requires explicit neutralization for audience and foreign attachment ownership risk', () => {
    const consumer = row(CONSUMER_ID, {
      type: 'doc',
      content: [legacyNode()],
    });
    const audienceSource = row(
      SOURCE_ID,
      { type: 'doc', content: [{ type: 'paragraph' }] },
      'space-2',
    );
    const audience = materializePageEmbeds(
      consumer,
      context(consumer, audienceSource),
      'block',
    );
    expect(containsPageEmbed(audience.value)).toBe(true);
    expect(audience.report.unsafeAudience).toBe(1);

    const attachmentSource = row(SOURCE_ID, {
      type: 'doc',
      content: [
        { type: 'image', attrs: { attachmentId: ATTACHMENT_ID } },
      ],
    });
    const attachmentContext = context(consumer, attachmentSource);
    attachmentContext.attachments.set(ATTACHMENT_ID, {
      id: ATTACHMENT_ID,
      pageId: SOURCE_ID,
      deletedAt: null,
    });
    const attachment = materializePageEmbeds(
      consumer,
      attachmentContext,
      'neutralize',
    );
    expect(containsPageEmbed(attachment.value)).toBe(false);
    expect(attachment.report.unsafeAttachmentOwnership).toBe(0);
    expect(attachment.report.attachmentCloneRequests).toEqual([
      {
        consumerPageId: CONSUMER_ID,
        sourcePageId: SOURCE_ID,
        sourceAttachmentId: ATTACHMENT_ID,
      },
    ]);
    expect(JSON.stringify(attachment.value)).toContain(
      pageEmbedAttachmentCloneId(CONSUMER_ID, ATTACHMENT_ID),
    );

    attachmentContext.attachments.set(ATTACHMENT_ID, {
      id: ATTACHMENT_ID,
      pageId: '10000000-0000-4000-8000-000000000099',
      deletedAt: null,
    });
    const foreign = materializePageEmbeds(
      consumer,
      attachmentContext,
      'neutralize',
    );
    expect(foreign.report.unsafeAttachmentOwnership).toBe(1);
  });

  it('neutralizes nested immutable-surface nodes without source lookup', () => {
    const result = neutralizePageEmbeds({
      type: 'doc',
      content: [{ content: [{ content: [legacyNode()] }] }],
    });
    expect(containsPageEmbed(result)).toBe(false);
  });

  it('keeps plan read-only and fences apply behind exact acknowledgements', () => {
    expect(parsePageEmbedRemovalInvocation({})).toMatchObject({
      mode: 'plan',
      batchSize: 100,
      policies: {},
    });
    expect(() =>
      parsePageEmbedRemovalInvocation({ apply: true, yes: true }),
    ).toThrow('--maintenance-ack=api-collab-workers-stopped');
    expect(
      parsePageEmbedRemovalInvocation({
        apply: true,
        yes: true,
        'maintenance-ack': 'api-collab-workers-stopped',
        'backup-ack': 'backup-verified-2026-08-22',
        'page-history-policy': 'purge',
        'batch-size': '50',
      }),
    ).toMatchObject({
      mode: 'apply',
      batchSize: 50,
      policies: { pageHistory: 'purge' },
    });
  });
});
