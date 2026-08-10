import { ForbiddenException } from '@nestjs/common';
import { FileTaskController } from './file-task.controller';

describe('FileTaskController', () => {
  const fileTask = {
    id: '019f0000-0000-7000-8000-000000000001',
    creatorId: 'creator-user',
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    filePath: 'workspace-1/imports/task/archive.zip',
    result: { preview: { displayName: 'Private archive' } },
  };
  const spaceAbility = {
    createForUser: jest.fn(async () => ({ cannot: () => false })),
  };
  const workspaceAbility = {
    createForUser: jest.fn(() => ({ can: () => false, cannot: () => true })),
  };
  const pageAccessService = {
    hasAnyReadablePageInSpace: jest.fn(async () => true),
  };
  const fileTaskQueryService = {
    findById: jest.fn(async () => fileTask),
  };
  const controller = new FileTaskController(
    spaceAbility as any,
    workspaceAbility as any,
    pageAccessService as any,
    fileTaskQueryService as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('does not disclose another creator\'s task to a same-space reader', async () => {
    await expect(
      (controller.getFileTask as any)(
        { fileTaskId: fileTask.id },
        { id: 'different-user' } as any,
        { id: fileTask.workspaceId } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
