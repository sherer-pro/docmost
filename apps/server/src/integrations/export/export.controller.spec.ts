import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PageExportController } from './export.controller';

describe('PageExportController markdown copy with comments', () => {
  const exportService = {};
  const pageRepo = {
    findById: jest.fn(),
  };
  const spaceAbility = {
    createForUser: jest.fn(),
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

function createUser(role: 'owner' | 'admin' | 'member') {
  return {
    id: `user-${role}`,
    role,
    locale: 'en-US',
    workspaceId: 'workspace-1',
  } as any;
}
