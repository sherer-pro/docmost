import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RagContentExportService as RagService } from './rag-content-export.service';

describe('RagService attachment download authorization', () => {
  const scope = {
    user: { id: 'user-1' },
    workspace: { id: 'workspace-1' },
    space: { id: 'space-1' },
  } as any;
  const attachment = {
    id: 'file-1',
    workspaceId: scope.workspace.id,
    spaceId: scope.space.id,
    pageId: 'page-1',
    fileName: 'notes.txt',
    fileExt: '.txt',
    mimeType: 'text/plain',
    deletedAt: null,
  };
  const page = {
    id: attachment.pageId,
    workspaceId: scope.workspace.id,
    spaceId: scope.space.id,
    deletedAt: null,
  };

  function createService(options?: {
    attachment?: any;
    page?: any;
    canRead?: boolean;
    excluded?: boolean;
  }) {
    const attachmentRepo = {
      findById: jest.fn().mockResolvedValue(options?.attachment ?? attachment),
    };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue(options?.page ?? page),
    };
    const pageAccess = {
      getEffectiveAccess: jest.fn().mockResolvedValue({
        capabilities: { canRead: options?.canRead ?? true },
      }),
    };
    const service = new RagService(
      {} as any,
      pageRepo as any,
      {} as any,
      {} as any,
      {} as any,
      attachmentRepo as any,
      {} as any,
      {} as any,
      pageAccess as any,
      {
        isPageExcluded: jest.fn().mockResolvedValue(options?.excluded ?? false),
        getExcludedPageIds: jest.fn().mockResolvedValue(new Set()),
        getRagSearchPolicy: jest.fn().mockResolvedValue({
          revision: 0,
          fingerprint: 'policy-fingerprint',
          ragSearchFingerprint: 'rag-search-fingerprint',
          ragSearchDoneOnly: false,
          excludedPageIds: [],
          statusBlockedPageIds: [],
        }),
      } as any,
      {} as any,
      {
        isAttachmentSupported: jest.fn(
          (value) =>
            value.fileExt === '.txt' && value.mimeType === 'text/plain',
        ),
      } as any,
    );
    return { service, pageAccess };
  }

  it('rechecks owning page access immediately before download', async () => {
    const { service, pageAccess } = createService();

    await expect(
      service.resolveAttachmentForDownload(scope, attachment.id),
    ).resolves.toMatchObject({ id: attachment.id });
    expect(pageAccess.getEffectiveAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: page.id }),
      scope.user,
    );
  });

  it('rejects a file after page access is revoked', async () => {
    const { service } = createService({ canRead: false });

    await expect(
      service.resolveAttachmentForDownload(scope, attachment.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an attachment owned by an AI-excluded page', async () => {
    const { service } = createService({ excluded: true });

    await expect(
      service.resolveAttachmentForDownload(scope, attachment.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose PDF, DOCX, or image attachments through RAG download', async () => {
    for (const unsupported of [
      {
        fileName: 'document.pdf',
        fileExt: '.pdf',
        mimeType: 'application/pdf',
      },
      {
        fileName: 'document.docx',
        fileExt: '.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      { fileName: 'image.png', fileExt: '.png', mimeType: 'image/png' },
    ]) {
      const { service } = createService({
        attachment: { ...attachment, ...unsupported },
      });
      await expect(
        service.resolveAttachmentForDownload(scope, attachment.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('does not expose deleted files or files on deleted pages', async () => {
    const deletedFile = createService({
      attachment: { ...attachment, deletedAt: new Date() },
    });
    await expect(
      deletedFile.service.resolveAttachmentForDownload(scope, attachment.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    const deletedPage = createService({
      page: { ...page, deletedAt: new Date() },
    });
    await expect(
      deletedPage.service.resolveAttachmentForDownload(scope, attachment.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
