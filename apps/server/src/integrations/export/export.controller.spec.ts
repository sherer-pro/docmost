import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  PageExportController,
  SpaceExportController,
} from './export.controller';
import { ExportFormat } from './dto/export-dto';

describe('PageExportController markdown copy with comments', () => {
  const exportService = {};
  const pageRepo = {
    findById: jest.fn(),
  };
  const spaceAbility = {
    createForUser: jest.fn(),
    assertHasFullSpaceAccess: jest.fn(async () => undefined),
  };
  const pageAccessService = {
    assertCanReadPage: jest.fn(async () => undefined),
    assertCanManageAccess: jest.fn(),
  };
  const copyMarkdownWithCommentsService = {
    build: jest.fn(async () => '# Page\n\nBody\n\n---\n\n## Comments'),
  };
  const controller = new PageExportController(
    exportService as any,
    pageRepo as any,
    spaceAbility as any,
    pageAccessService as any,
    copyMarkdownWithCommentsService as any,
  );
  const page = {
    id: 'page-1',
    workspaceId: 'workspace-1',
    deletedAt: null,
    content: { type: 'doc', content: [] },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    pageRepo.findById.mockResolvedValue(page);
    pageAccessService.assertCanManageAccess.mockImplementation((user) => {
      if (user.role !== 'owner' && user.role !== 'admin') {
        throw new ForbiddenException();
      }
    });
  });

  it('returns markdown for workspace admins', async () => {
    await expect(
      controller.copyMarkdownWithCommentsAction(
        { pageId: page.id },
        createUser('admin'),
      ),
    ).resolves.toEqual({
      markdown: '# Page\n\nBody\n\n---\n\n## Comments',
    });
    expect(pageRepo.findById).toHaveBeenCalledWith(page.id, {
      includeContent: true,
    });
    expect(pageAccessService.assertCanReadPage).toHaveBeenCalledWith(
      page,
      expect.objectContaining({ role: 'admin' }),
    );
    expect(pageAccessService.assertCanManageAccess).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      page.workspaceId,
    );
    expect(copyMarkdownWithCommentsService.build).toHaveBeenCalledWith(
      page,
      'en-US',
    );
  });

  it('returns markdown for workspace owners', async () => {
    await expect(
      controller.copyMarkdownWithCommentsAction(
        { pageId: page.id },
        createUser('owner'),
      ),
    ).resolves.toEqual({
      markdown: '# Page\n\nBody\n\n---\n\n## Comments',
    });
  });

  it('rejects regular workspace members', async () => {
    await expect(
      controller.copyMarkdownWithCommentsAction(
        { pageId: page.id },
        createUser('member'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(copyMarkdownWithCommentsService.build).not.toHaveBeenCalled();
  });

  it('throws not found for missing or deleted pages', async () => {
    pageRepo.findById.mockResolvedValueOnce(null);

    await expect(
      controller.copyMarkdownWithCommentsAction(
        { pageId: page.id },
        createUser('admin'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    pageRepo.findById.mockResolvedValueOnce({ ...page, deletedAt: new Date() });

    await expect(
      controller.copyMarkdownWithCommentsAction(
        { pageId: page.id },
        createUser('admin'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Export controllers full space access', () => {
  const exportService = {
    exportPages: jest.fn(async () => 'page-stream'),
    exportSpace: jest.fn(async () => ({
      fileName: 'Space.zip',
      fileStream: 'space-stream',
    })),
  };
  const pageRepo = {
    findById: jest.fn(),
  };
  const spaceAbility = {
    assertHasFullSpaceAccess: jest.fn(async () => undefined),
  };
  const pageAccessService = {
    assertCanReadPage: jest.fn(async () => undefined),
  };
  const copyMarkdownWithCommentsService = {};
  const pageController = new PageExportController(
    exportService as any,
    pageRepo as any,
    spaceAbility as any,
    pageAccessService as any,
    copyMarkdownWithCommentsService as any,
  );
  const spaceController = new SpaceExportController(
    exportService as any,
    pageRepo as any,
    spaceAbility as any,
    pageAccessService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      title: 'Page',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      parentPageId: null,
      deletedAt: null,
    });
    exportService.exportPages.mockResolvedValue('page-stream');
    exportService.exportSpace.mockResolvedValue({
      fileName: 'Space.zip',
      fileStream: 'space-stream',
    });
    spaceAbility.assertHasFullSpaceAccess.mockResolvedValue(undefined);
  });

  it('requires full space access for a top-level page export', async () => {
    const reply = createReply();

    await pageController.exportPageAction(
      {
        pageId: 'page-1',
        format: ExportFormat.Markdown,
      },
      createUser('member'),
      reply as any,
    );

    expect(pageAccessService.assertCanReadPage).toHaveBeenCalled();
    expect(spaceAbility.assertHasFullSpaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-member' }),
      'space-1',
    );
    expect(reply.send).toHaveBeenCalledWith('page-stream');
  });

  it('keeps readable nested page export unchanged', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'page-2',
      title: 'Nested page',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      parentPageId: 'page-1',
      deletedAt: null,
    });

    await pageController.exportPageAction(
      {
        pageId: 'page-2',
        format: ExportFormat.PDF,
      },
      createUser('member'),
      createReply() as any,
    );

    expect(spaceAbility.assertHasFullSpaceAccess).not.toHaveBeenCalled();
    expect(exportService.exportPages).toHaveBeenCalled();
  });

  it('does not start a top-level page export after a full-access denial', async () => {
    spaceAbility.assertHasFullSpaceAccess.mockRejectedValueOnce(
      new ForbiddenException(),
    );

    await expect(
      pageController.exportPageAction(
        {
          pageId: 'page-1',
          format: ExportFormat.HTML,
        },
        createUser('member'),
        createReply() as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(exportService.exportPages).not.toHaveBeenCalled();
  });

  it('requires full space access for a whole-space export', async () => {
    const reply = createReply();

    await spaceController.exportSpaceAction(
      {
        spaceId: 'space-1',
        format: ExportFormat.Markdown,
      },
      createUser('admin'),
      reply as any,
    );

    expect(spaceAbility.assertHasFullSpaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      'space-1',
    );
    expect(reply.send).toHaveBeenCalledWith('space-stream');
  });

  it('does not start a whole-space export after a full-access denial', async () => {
    spaceAbility.assertHasFullSpaceAccess.mockRejectedValueOnce(
      new ForbiddenException(),
    );

    await expect(
      spaceController.exportSpaceAction(
        {
          spaceId: 'space-1',
          format: ExportFormat.HTML,
        },
        createUser('member'),
        createReply() as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(exportService.exportSpace).not.toHaveBeenCalled();
  });
});

function createUser(role: 'owner' | 'admin' | 'member') {
  return {
    id: `user-${role}`,
    role,
    locale: 'en-US',
    workspaceId: 'workspace-1',
  } as any;
}

function createReply() {
  return {
    headers: jest.fn(),
    send: jest.fn(),
  };
}
