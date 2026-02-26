import { BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import { AttachmentType } from '../attachment.constants';
import { AttachmentService } from './attachment.service';

describe('AttachmentService spoof validation', () => {
  const storageService = { upload: jest.fn(), delete: jest.fn() };
  const attachmentRepo = {
    findById: jest.fn(),
    updateAttachment: jest.fn(),
    insertAttachment: jest.fn(),
    deleteAttachmentByFilePath: jest.fn(),
    findBySpaceId: jest.fn(),
    deleteAttachmentById: jest.fn(),
  };
  const userRepo = { findById: jest.fn(), updateUser: jest.fn() };
  const workspaceRepo = {
    findById: jest.fn(),
    updateWorkspace: jest.fn(),
  };
  const spaceRepo = { findById: jest.fn(), updateSpace: jest.fn() };
  const db = {
    selectFrom: jest.fn(),
  };
  const attachmentQueue = { add: jest.fn() };

  const service = new AttachmentService(
    storageService as any,
    attachmentRepo as any,
    userRepo as any,
    workspaceRepo as any,
    spaceRepo as any,
    db as any,
    attachmentQueue as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploadImage rejects png extension with zip signature', async () => {
    const zipBuffer = Buffer.from('504b0304140000000800', 'hex');

    const filePromise = Promise.resolve({
      filename: 'avatar.png',
      mimetype: 'image/png',
      toBuffer: jest.fn().mockResolvedValue(zipBuffer),
      file: Readable.from(zipBuffer),
    });

    await expect(
      service.uploadImage(
        filePromise as any,
        AttachmentType.Avatar,
        'user-id',
        'workspace-id',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(storageService.upload).not.toHaveBeenCalled();
  });

  it('uploadFile rejects pdf extension with png signature', async () => {
    const pngBuffer = Buffer.from(
      '89504e470d0a1a0a0000000d49484452',
      'hex',
    );

    const filePromise = Promise.resolve({
      filename: 'document.pdf',
      mimetype: 'application/pdf',
      file: Readable.from(pngBuffer),
      fields: {},
    });

    await expect(
      service.uploadFile({
        filePromise: filePromise as any,
        pageId: 'page-id',
        userId: 'user-id',
        spaceId: 'space-id',
        workspaceId: 'workspace-id',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(storageService.upload).not.toHaveBeenCalled();
  });
});
