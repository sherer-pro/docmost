import { ForbiddenException } from '@nestjs/common';
import { ImportController } from './import.controller';

describe('ImportController Docmost confirmation authorization', () => {
  it('rejects confirmation when page edit access was revoked after preview', async () => {
    const importService = {
      getPendingDocmostImportSpaceId: jest.fn(async () => 'space-1'),
      confirmDocmostImport: jest.fn(),
    };
    const spaceAbility = {
      createForUser: jest.fn(async () => ({
        cannot: jest.fn(() => true),
        can: jest.fn(() => false),
      })),
    };
    const workspaceAbility = {
      createForUser: jest.fn(() => ({ can: jest.fn(() => false) })),
    };
    const controller = new ImportController(
      importService as any,
      spaceAbility as any,
      workspaceAbility as any,
      {} as any,
    );

    await expect(
      controller.confirmImportZipAction(
        {
          fileTaskId: 'task-1',
          applyDocumentFields: false,
          applyDictionary: false,
          applyHeadingNumbering: false,
          applyTags: false,
        },
        { id: 'user-1' } as any,
        { id: 'workspace-1' } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(importService.confirmDocmostImport).not.toHaveBeenCalled();
  });
});
