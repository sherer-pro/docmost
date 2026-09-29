import { Readable } from 'node:stream';
import { AiCanonicalEvidenceService } from './ai-canonical-evidence.service';

describe('AiCanonicalEvidenceService', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const user = { id: 'reader' } as any;
  const pageHit = {
    sourceType: 'page' as const,
    sourceId: 'page',
    pageId: 'page',
    text: 'Old value 100',
  };
  function setup() {
    const query: any = {
      selectAll: () => query,
      where: () => query,
      executeTakeFirst: async () => ({ id: 'space' }),
    };
    const rag = {
      getPageInfo: jest.fn(async (_scope: unknown, _id: string) => ({
        type: 'page',
        knowledgeMarkdown: 'Current value 200',
        projectionUpdatedAt: now,
      })),
      resolveAttachmentForDownload: jest.fn(async () => ({
        pageId: 'page',
        fileSize: 20,
        filePath: 'safe/path',
        updatedAt: now,
      })),
    };
    const storage = {
      readStream: jest.fn(async () =>
        Readable.from([Buffer.from('Current attachment 200')]),
      ),
    };
    return {
      rag,
      storage,
      service: new AiCanonicalEvidenceService(
        { selectFrom: () => query } as any,
        rag as any,
        storage as any,
      ),
    };
  }

  it('loads through a user-scoped export instead of the stale remote payload', async () => {
    const { service, rag } = setup();
    const evidence = await service.load(pageHit, user, 'workspace', 'space');
    expect(evidence).toMatchObject({
      markdown: 'Current value 200',
      version: now.toISOString(),
    });
    expect(rag.getPageInfo).toHaveBeenCalledWith(
      expect.objectContaining({ user, workspace: { id: 'workspace' } }),
      'page',
    );
    expect(rag.getPageInfo.mock.calls[0][0]).not.toHaveProperty('accessMode');
  });

  it('does not fall back to remote text when export authorization rejects access', async () => {
    const { service, rag } = setup();
    rag.getPageInfo.mockRejectedValueOnce(new Error('access revoked'));
    await expect(
      service.load(pageHit, user, 'workspace', 'space'),
    ).rejects.toThrow('access revoked');
  });

  it('reads current attachment bytes and checks the page association first', async () => {
    const { service, storage } = setup();
    const hit = {
      ...pageHit,
      sourceType: 'attachment' as const,
      sourceId: 'file',
    };
    expect(
      (await service.load(hit, user, 'workspace', 'space'))?.markdown,
    ).toBe('Current attachment 200');
    storage.readStream.mockClear();
    expect(
      await service.load(
        { ...hit, pageId: 'moved' },
        user,
        'workspace',
        'space',
      ),
    ).toBeNull();
    expect(storage.readStream).not.toHaveBeenCalled();
  });
});
