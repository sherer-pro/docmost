import {
  RagAttachmentTextProjector,
  RagContentProjectorService,
  RagStructuredKnowledgeProjector,
} from './rag-content-projector.service';

describe('RagContentProjectorService', () => {
  const createService = (enabled = 'attachment-text-v1') =>
    new RagContentProjectorService(
      { getRagContentProcessorsEnabled: () => enabled } as any,
      new RagStructuredKnowledgeProjector(),
      new RagAttachmentTextProjector(),
    );

  it('enables only structured knowledge and Markdown or text attachments', () => {
    const service = createService();

    expect(service.getCapabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          processorId: 'structured-knowledge-v2',
          state: 'enabled',
        }),
        expect.objectContaining({
          processorId: 'attachment-text-v1',
          state: 'enabled',
          extensions: ['.md', '.txt'],
        }),
        expect.objectContaining({
          processorId: 'pdf-text-v1',
          state: 'disabled',
        }),
        expect.objectContaining({
          processorId: 'image-ocr-v1',
          state: 'disabled',
        }),
      ]),
    );
    expect(
      service.isAttachmentSupported({
        fileName: 'notes.md',
        fileExt: '.md',
        mimeType: 'text/markdown',
      }),
    ).toBe(true);
    expect(
      service.isAttachmentSupported({
        fileName: 'document.pdf',
        fileExt: '.pdf',
        mimeType: 'application/pdf',
      }),
    ).toBe(false);
    expect(
      service.isAttachmentSupported({
        fileName: 'image.png',
        fileExt: '.png',
        mimeType: 'image/png',
      }),
    ).toBe(false);
  });

  it('requires an allowed MIME type as well as an allowed extension', () => {
    const service = createService();

    expect(
      service.isAttachmentSupported({
        fileName: 'fake.txt',
        fileExt: '.txt',
        mimeType: 'application/pdf',
      }),
    ).toBe(false);
    expect(
      service.isAttachmentSupported({
        fileName: 'unknown.txt',
        fileExt: '.txt',
        mimeType: null,
      }),
    ).toBe(false);
  });

  it('projects structured knowledge through the same multipart contract', () => {
    const projection = createService().projectStructuredKnowledge({
      sourceType: 'page',
      sourceId: 'page-1',
      pageId: 'page-1',
      fileName: 'page.md',
      markdown: '# Page',
    });

    expect(projection).toMatchObject({
      projectorId: 'structured-knowledge-v2',
      sourceType: 'page',
      sourceId: 'page-1',
      parts: [
        expect.objectContaining({
          partId: 'main',
          fileName: 'page.md',
          locator: { pageId: 'page-1' },
        }),
      ],
    });
  });

  it('rejects reserved processors until an implementation is registered', () => {
    expect(() => createService('pdf-text-v1')).toThrow(
      'Unsupported RAG content processor: pdf-text-v1',
    );
  });
});
