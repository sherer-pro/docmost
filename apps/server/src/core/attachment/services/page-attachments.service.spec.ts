import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PageAttachmentsService } from './page-attachments.service';

describe('PageAttachmentsService removal authorization', () => {
  const user = { id: 'user', workspaceId: 'workspace' } as any;
  function setup(admin = true, writable = true) {
    const db = { transaction: jest.fn() };
    const pages = {
      findById: jest.fn().mockResolvedValue({
        id: 'page',
        spaceId: 'space',
        workspaceId: 'workspace',
      }),
    };
    const access = {
      assertCanReadPage: jest.fn().mockResolvedValue(undefined),
      assertCanWritePage: jest.fn().mockImplementation(async () => {
        if (!writable) throw new ForbiddenException();
      }),
    };
    const abilities = {
      createForUser: jest.fn().mockResolvedValue({ can: () => admin }),
    };
    const outbox = { enqueueAttachmentCleanup: jest.fn(), kick: jest.fn() };
    return {
      db,
      pages,
      access,
      outbox,
      service: new PageAttachmentsService(
        db as any,
        pages as any,
        access as any,
        abilities as any,
        outbox as any,
      ),
    };
  }
  it.each([
    [false, true],
    [true, false],
  ])(
    'requires both space administration and current page write: %p / %p',
    async (admin, writable) => {
      const { service, db, outbox } = setup(admin, writable);
      await expect(service.remove('page', 'file', user)).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.transaction).not.toHaveBeenCalled();
      expect(outbox.enqueueAttachmentCleanup).not.toHaveBeenCalled();
    },
  );
  it('does not disclose a foreign workspace page', async () => {
    const { service, pages, access } = setup();
    pages.findById.mockResolvedValue({ id: 'page', workspaceId: 'other' });
    await expect(service.list('page', {} as any, user)).rejects.toThrow(
      NotFoundException,
    );
    expect(access.assertCanReadPage).not.toHaveBeenCalled();
    expect(pages.findById).toHaveBeenCalledWith('page', {
      includeContent: true,
    });
  });
});
