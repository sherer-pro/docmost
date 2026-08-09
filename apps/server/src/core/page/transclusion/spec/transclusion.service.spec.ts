import { Test } from '@nestjs/testing';
import { TransclusionService } from '../transclusion.service';
import { PageTransclusionsRepo } from '@docmost/db/repos/page-transclusions/page-transclusions.repo';
import { PageTransclusionReferencesRepo } from '@docmost/db/repos/page-transclusions/page-transclusion-references.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../../integrations/storage/storage.service';
import { PageAccessService } from '../../../page-access/page-access.service';
import { ForbiddenException } from '@nestjs/common';

describe('TransclusionService.syncPageTransclusions', () => {
  let service: TransclusionService;
  let repo: jest.Mocked<PageTransclusionsRepo>;

  beforeEach(async () => {
    const mockRepo: jest.Mocked<Partial<PageTransclusionsRepo>> = {
      findByPageId: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      deleteByPageAndTransclusionIds: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        TransclusionService,
        { provide: PageTransclusionsRepo, useValue: mockRepo },
        { provide: PageTransclusionReferencesRepo, useValue: {} },
        { provide: PageRepo, useValue: {} },
        { provide: AttachmentRepo, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: PageAccessService, useValue: {} },
      ],
    }).compile();
    service = module.get(TransclusionService);
    repo = module.get(PageTransclusionsRepo);
  });

  const pageId = '00000000-0000-0000-0000-000000000001';
  const workspaceId = '00000000-0000-0000-0000-000000000099';

  it('inserts new transclusions that did not exist before', async () => {
    repo.findByPageId.mockResolvedValue([]);
    const pm = {
      type: 'doc',
      content: [
        {
          type: 'transclusionSource',
          attrs: { id: 'a' },
          content: [{ type: 'paragraph' }],
        },
      ],
    };

    const result = await service.syncPageTransclusions(pageId, workspaceId, pm);

    expect(result).toEqual({ inserted: 1, updated: 0, deleted: 0 });
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId,
        transclusionId: 'a',
      }),
      undefined,
    );
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.deleteByPageAndTransclusionIds).not.toHaveBeenCalled();
  });

  it('updates transclusions whose content changed', async () => {
    repo.findByPageId.mockResolvedValue([
      {
        id: 'row1',
        pageId,
        transclusionId: 'a',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);
    const newContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'X' }] }],
    };
    const pm = {
      type: 'doc',
      content: [
        {
          type: 'transclusionSource',
          attrs: { id: 'a' },
          content: newContent.content,
        },
      ],
    };

    const result = await service.syncPageTransclusions(pageId, workspaceId, pm);

    expect(result).toEqual({ inserted: 0, updated: 1, deleted: 0 });
    expect(repo.update).toHaveBeenCalledWith(
      pageId,
      'a',
      expect.objectContaining({ content: newContent }),
      undefined,
    );
  });

  it('skips update when content is unchanged', async () => {
    const sameContent = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
    repo.findByPageId.mockResolvedValue([
      {
        id: 'row1',
        pageId,
        transclusionId: 'a',
        content: sameContent,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);
    const pm = {
      type: 'doc',
      content: [
        {
          type: 'transclusionSource',
          attrs: { id: 'a' },
          content: sameContent.content,
        },
      ],
    };

    const result = await service.syncPageTransclusions(pageId, workspaceId, pm);

    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('deletes transclusions that no longer appear in the doc', async () => {
    repo.findByPageId.mockResolvedValue([
      {
        id: 'r',
        pageId,
        transclusionId: 'gone',
        content: { type: 'doc', content: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);
    const pm = { type: 'doc', content: [{ type: 'paragraph' }] };

    const result = await service.syncPageTransclusions(pageId, workspaceId, pm);

    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 1 });
    expect(repo.deleteByPageAndTransclusionIds).toHaveBeenCalledWith(
      pageId,
      ['gone'],
      undefined,
    );
  });

  it('handles empty doc → noop', async () => {
    repo.findByPageId.mockResolvedValue([]);
    const result = await service.syncPageTransclusions(
      pageId,
      workspaceId,
      null,
    );
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    expect(repo.insert).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.deleteByPageAndTransclusionIds).not.toHaveBeenCalled();
  });
});

describe('TransclusionService.syncPageReferences', () => {
  let service: TransclusionService;
  let refRepo: jest.Mocked<PageTransclusionReferencesRepo>;

  beforeEach(async () => {
    const mockTransclusionsRepo: Partial<PageTransclusionsRepo> = {};
    const mockRefRepo: jest.Mocked<Partial<PageTransclusionReferencesRepo>> = {
      findByReferencePageId: jest.fn(),
      insertMany: jest.fn(),
      deleteByReferenceAndKeys: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        TransclusionService,
        { provide: PageTransclusionsRepo, useValue: mockTransclusionsRepo },
        { provide: PageTransclusionReferencesRepo, useValue: mockRefRepo },
        { provide: PageRepo, useValue: {} },
        { provide: AttachmentRepo, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: PageAccessService, useValue: {} },
      ],
    }).compile();
    service = module.get(TransclusionService);
    refRepo = module.get(PageTransclusionReferencesRepo);
  });

  const referencePageId = '00000000-0000-0000-0000-000000000001';
  const workspaceId = '00000000-0000-0000-0000-000000000099';

  it('inserts new loose references, no deletes when none existed', async () => {
    refRepo.findByReferencePageId.mockResolvedValue([]);
    const pm = {
      type: 'doc',
      content: [
        {
          type: 'transclusionReference',
          attrs: { sourcePageId: 'p1', transclusionId: 'e1' },
        },
        {
          type: 'transclusionReference',
          attrs: { sourcePageId: 'p2', transclusionId: 'e2' },
        },
      ],
    };

    const result = await service.syncPageReferences(
      referencePageId,
      workspaceId,
      pm,
    );

    expect(result).toEqual({ inserted: 2, deleted: 0 });
    expect(refRepo.insertMany).toHaveBeenCalledWith(
      [
        {
          workspaceId,
          referencePageId,
          sourcePageId: 'p1',
          transclusionId: 'e1',
          referenceKind: 'block',
          referenceNodeId: null,
        },
        {
          workspaceId,
          referencePageId,
          sourcePageId: 'p2',
          transclusionId: 'e2',
          referenceKind: 'block',
          referenceNodeId: null,
        },
      ],
      undefined,
    );
    expect(refRepo.deleteByReferenceAndKeys).not.toHaveBeenCalled();
  });

  it('rejects references nested inside a source (schema-forbidden)', async () => {
    refRepo.findByReferencePageId.mockResolvedValue([]);
    const pm = {
      type: 'doc',
      content: [
        {
          type: 'transclusionSource',
          attrs: { id: 's1' },
          content: [
            {
              type: 'transclusionReference',
              attrs: { sourcePageId: 'p2', transclusionId: 'e2' },
            },
          ],
        },
      ],
    };

    await expect(
      service.syncPageReferences(referencePageId, workspaceId, pm),
    ).rejects.toThrow('page_embed_malformed_mixed_content');
    expect(refRepo.insertMany).not.toHaveBeenCalled();
    expect(refRepo.deleteByReferenceAndKeys).not.toHaveBeenCalled();
  });

  it('deletes references that no longer appear', async () => {
    refRepo.findByReferencePageId.mockResolvedValue([
      {
        id: 'r1',
        referencePageId,
        sourcePageId: 'p1',
        transclusionId: 'e1',
        createdAt: new Date(),
      } as any,
    ]);
    const pm = { type: 'doc', content: [{ type: 'paragraph' }] };

    const result = await service.syncPageReferences(
      referencePageId,
      workspaceId,
      pm,
    );

    expect(result).toEqual({ inserted: 0, deleted: 1 });
    expect(refRepo.deleteByReferenceAndKeys).toHaveBeenCalledWith(
      referencePageId,
      [
        {
          sourcePageId: 'p1',
          transclusionId: 'e1',
        },
      ],
      undefined,
    );
    expect(refRepo.insertMany).not.toHaveBeenCalled();
  });

  it('is a no-op when desired matches existing exactly', async () => {
    refRepo.findByReferencePageId.mockResolvedValue([
      {
        id: 'r',
        referencePageId,
        sourcePageId: 'p1',
        transclusionId: 'e1',
        createdAt: new Date(),
      } as any,
    ]);
    const pm = {
      type: 'doc',
      content: [
        {
          type: 'transclusionReference',
          attrs: { sourcePageId: 'p1', transclusionId: 'e1' },
        },
      ],
    };

    const result = await service.syncPageReferences(
      referencePageId,
      workspaceId,
      pm,
    );

    expect(result).toEqual({ inserted: 0, deleted: 0 });
    expect(refRepo.insertMany).not.toHaveBeenCalled();
    expect(refRepo.deleteByReferenceAndKeys).not.toHaveBeenCalled();
  });
});

describe('TransclusionService.listReferences', () => {
  let service: TransclusionService;
  let refRepo: jest.Mocked<PageTransclusionReferencesRepo>;
  let pageRepo: jest.Mocked<PageRepo>;
  let pageAccessService: jest.Mocked<PageAccessService>;

  const sourcePageId = '00000000-0000-0000-0000-000000000001';
  const visibleReferencePageId = '00000000-0000-0000-0000-000000000002';
  const hiddenReferencePageId = '00000000-0000-0000-0000-000000000003';
  const deletedReferencePageId = '00000000-0000-0000-0000-000000000004';
  const workspaceId = '00000000-0000-0000-0000-000000000099';
  const viewer = { id: 'user-1', workspaceId } as any;

  beforeEach(async () => {
    const pages = new Map(
      [
        {
          id: sourcePageId,
          slugId: 'source',
          title: 'Source',
          icon: null,
          spaceId: 'space-1',
          workspaceId,
          deletedAt: null,
          updatedAt: new Date(),
          space: { slug: 'space' },
        },
        {
          id: visibleReferencePageId,
          slugId: 'visible',
          title: 'Visible',
          icon: null,
          spaceId: 'space-1',
          workspaceId,
          deletedAt: null,
          updatedAt: new Date(),
          space: { slug: 'space' },
        },
        {
          id: hiddenReferencePageId,
          slugId: 'hidden',
          title: 'Hidden',
          icon: null,
          spaceId: 'space-1',
          workspaceId,
          deletedAt: null,
          updatedAt: new Date(),
          space: { slug: 'space' },
        },
        {
          id: deletedReferencePageId,
          slugId: 'deleted',
          title: 'Deleted',
          icon: null,
          spaceId: 'space-1',
          workspaceId,
          deletedAt: new Date(),
          updatedAt: new Date(),
          space: { slug: 'space' },
        },
      ].map((page) => [page.id, page]),
    );
    const mockRefRepo: jest.Mocked<Partial<PageTransclusionReferencesRepo>> = {
      findReferencePageIdsByTransclusion: jest.fn(),
      hasLiveReferences: jest.fn(),
    };
    const mockPageRepo: jest.Mocked<Partial<PageRepo>> = {
      findById: jest.fn(async (id) => pages.get(id) as any),
    };
    const mockPageAccessService: jest.Mocked<Partial<PageAccessService>> = {
      getEffectiveAccessForPages: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        TransclusionService,
        { provide: PageTransclusionsRepo, useValue: {} },
        { provide: PageTransclusionReferencesRepo, useValue: mockRefRepo },
        { provide: PageRepo, useValue: mockPageRepo },
        { provide: AttachmentRepo, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: PageAccessService, useValue: mockPageAccessService },
      ],
    }).compile();

    service = module.get(TransclusionService);
    refRepo = module.get(PageTransclusionReferencesRepo);
    pageRepo = module.get(PageRepo);
    pageAccessService = module.get(PageAccessService);
  });

  it('reports hidden live references without exposing their page metadata', async () => {
    refRepo.findReferencePageIdsByTransclusion.mockResolvedValue([
      visibleReferencePageId,
      hiddenReferencePageId,
    ]);
    refRepo.hasLiveReferences.mockResolvedValue(true);
    pageAccessService.getEffectiveAccessForPages.mockImplementation(
      async (pages) =>
        new Map(
          pages.map((page) => [
            page.id,
            {
              capabilities: {
                canRead: page.id !== hiddenReferencePageId,
              },
            } as any,
          ]),
        ),
    );

    const result = await service.listReferences({
      sourcePageId,
      transclusionId: 'block-1',
      viewer,
    });

    expect(result.hasReferences).toBe(true);
    expect(result.source?.id).toBe(sourcePageId);
    expect(result.references.map((page) => page.id)).toEqual([
      visibleReferencePageId,
    ]);
    expect(pageAccessService.getEffectiveAccessForPages).toHaveBeenCalledTimes(
      1,
    );
    expect(pageRepo.findById).toHaveBeenCalledWith(hiddenReferencePageId);
  });

  it('reports an unreferenced source', async () => {
    refRepo.findReferencePageIdsByTransclusion.mockResolvedValue([]);
    refRepo.hasLiveReferences.mockResolvedValue(false);
    pageAccessService.getEffectiveAccessForPages.mockResolvedValue(
      new Map([[sourcePageId, { capabilities: { canRead: true } } as any]]),
    );

    const result = await service.listReferences({
      sourcePageId,
      transclusionId: 'block-1',
      viewer,
    });

    expect(result.hasReferences).toBe(false);
    expect(result.references).toEqual([]);
  });

  it('does not count or expose references on deleted pages', async () => {
    refRepo.findReferencePageIdsByTransclusion.mockResolvedValue([
      deletedReferencePageId,
    ]);
    refRepo.hasLiveReferences.mockResolvedValue(false);
    pageAccessService.getEffectiveAccessForPages.mockResolvedValue(
      new Map([[sourcePageId, { capabilities: { canRead: true } } as any]]),
    );

    const result = await service.listReferences({
      sourcePageId,
      transclusionId: 'block-1',
      viewer,
    });

    expect(result.hasReferences).toBe(false);
    expect(result.references).toEqual([]);
    expect(pageAccessService.getEffectiveAccessForPages).toHaveBeenCalledWith(
      [expect.objectContaining({ id: sourcePageId })],
      viewer,
    );
  });
});

describe('TransclusionService lookup and unsync access boundaries', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000099';
  const referencePageId = '00000000-0000-0000-0000-000000000001';
  const sourcePageId = '00000000-0000-0000-0000-000000000002';
  const viewer = { id: 'user-1', workspaceId } as any;
  const referencePage = {
    id: referencePageId,
    workspaceId,
    spaceId: 'space-1',
    deletedAt: null,
  } as any;
  const sourcePage = {
    id: sourcePageId,
    workspaceId,
    spaceId: 'space-1',
    deletedAt: null,
    updatedAt: new Date('2026-08-09T00:00:00.000Z'),
  } as any;

  it('returns no_access without reading a denied source block', async () => {
    const transclusions = {
      findManyByPageAndTransclusion: jest.fn(async () => []),
    } as any;
    const pages = {
      findById: jest.fn(async () => sourcePage),
    } as any;
    const access = {
      getEffectiveAccessForPages: jest.fn(
        async () =>
          new Map([[sourcePageId, { capabilities: { canRead: false } }]]),
      ),
    } as any;
    const service = new TransclusionService(
      transclusions,
      {} as any,
      pages,
      {} as any,
      {} as any,
      access,
    );

    await expect(
      service.lookup(
        [{ sourcePageId, transclusionId: 'restricted-block' }],
        viewer,
      ),
    ).resolves.toEqual({
      items: [
        {
          sourcePageId,
          transclusionId: 'restricted-block',
          status: 'no_access',
        },
      ],
    });
    expect(transclusions.findManyByPageAndTransclusion).toHaveBeenCalledWith(
      [],
      workspaceId,
    );
  });

  it('checks reference write and source read access before unsyncing', async () => {
    const transclusions = {
      findByPageAndTransclusion: jest.fn(),
    } as any;
    const references = { deleteOne: jest.fn() } as any;
    const pages = {
      findById: jest.fn(async (id: string) =>
        id === referencePageId ? referencePage : sourcePage,
      ),
    } as any;
    const access = {
      assertCanWritePage: jest.fn(),
      assertCanReadPage: jest.fn(async () => {
        throw new ForbiddenException();
      }),
    } as any;
    const service = new TransclusionService(
      transclusions,
      references,
      pages,
      {} as any,
      {} as any,
      access,
    );

    await expect(
      service.unsyncReference(
        referencePageId,
        sourcePageId,
        'restricted-block',
        viewer,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.assertCanWritePage).toHaveBeenCalledWith(
      referencePage,
      viewer,
    );
    expect(access.assertCanReadPage).toHaveBeenCalledWith(sourcePage, viewer);
    expect(transclusions.findByPageAndTransclusion).not.toHaveBeenCalled();
    expect(references.deleteOne).not.toHaveBeenCalled();
  });

  it('materializes an allowed reference without mutating the source block', async () => {
    const sourceContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Original source' }],
        },
      ],
    };
    const originalSnapshot = structuredClone(sourceContent);
    const transclusions = {
      findByPageAndTransclusion: jest.fn(async () => ({
        content: sourceContent,
      })),
    } as any;
    const references = { deleteOne: jest.fn() } as any;
    const pages = {
      findById: jest.fn(async (id: string) =>
        id === referencePageId ? referencePage : sourcePage,
      ),
    } as any;
    const access = {
      assertCanWritePage: jest.fn(),
      assertCanReadPage: jest.fn(),
    } as any;
    const service = new TransclusionService(
      transclusions,
      references,
      pages,
      { findByIds: jest.fn(async () => []) } as any,
      {} as any,
      access,
    );

    await expect(
      service.unsyncReference(
        referencePageId,
        sourcePageId,
        'shared-block',
        viewer,
      ),
    ).resolves.toEqual({ content: originalSnapshot });
    expect(sourceContent).toEqual(originalSnapshot);
    expect(references.deleteOne).toHaveBeenCalledWith(
      referencePageId,
      sourcePageId,
      'shared-block',
    );
  });
});
