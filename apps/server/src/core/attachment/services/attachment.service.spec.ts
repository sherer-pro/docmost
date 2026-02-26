import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Readable } from 'stream';
import { AttachmentType } from '../attachment.constants';
import { AttachmentService } from './attachment.service';
import * as attachmentUtils from '../attachment.utils';
import * as fileValidation from '../../../common/helpers/file-validation';

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

describe('AttachmentService uploadFile attachment overwrite validation', () => {
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

  const basePreparedFile = {
    fileName: 'diagram.drawio',
    fileExtension: '.drawio',
    fileSize: 128,
    mimeType: 'application/xml',
    multiPartFile: {
      file: Readable.from(Buffer.from('safe-content')),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Подготавливаем стабильный и безопасный вход для uploadFile без реального парсинга multipart.
    jest
      .spyOn(attachmentUtils, 'prepareFile')
      .mockResolvedValue(basePreparedFile as any);
    jest
      .spyOn(fileValidation, 'readMagicBytesFromStream')
      .mockResolvedValue(Buffer.from('73616665', 'hex'));
    jest
      .spyOn(fileValidation, 'validateFileExtensionAndSignature')
      .mockResolvedValue();

    storageService.upload.mockResolvedValue(undefined);
    attachmentRepo.updateAttachment.mockResolvedValue({
      id: 'attachment-id',
      fileExt: '.drawio',
    });
  });

  /**
   * Проверка, что несовпадение workspace блокирует перезапись существующего вложения.
   */
  it('throws ForbiddenException when only workspaceId mismatches', async () => {
    attachmentRepo.findById.mockResolvedValue({
      id: 'attachment-id',
      workspaceId: 'workspace-old',
      pageId: 'page-id',
      fileExt: '.drawio',
    });

    await expect(
      service.uploadFile({
        filePromise: Promise.resolve({} as any),
        attachmentId: 'attachment-id',
        pageId: 'page-id',
        userId: 'user-id',
        spaceId: 'space-id',
        workspaceId: 'workspace-new',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * Проверка, что несовпадение page блокирует перезапись даже при совпадении workspace и extension.
   */
  it('throws ForbiddenException when only pageId mismatches', async () => {
    attachmentRepo.findById.mockResolvedValue({
      id: 'attachment-id',
      workspaceId: 'workspace-id',
      pageId: 'page-old',
      fileExt: '.drawio',
    });

    await expect(
      service.uploadFile({
        filePromise: Promise.resolve({} as any),
        attachmentId: 'attachment-id',
        pageId: 'page-new',
        userId: 'user-id',
        spaceId: 'space-id',
        workspaceId: 'workspace-id',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * Проверка инварианта расширения: нельзя перезаписывать файл с другим fileExt.
   */
  it('throws ForbiddenException when only extension mismatches', async () => {
    attachmentRepo.findById.mockResolvedValue({
      id: 'attachment-id',
      workspaceId: 'workspace-id',
      pageId: 'page-id',
      fileExt: '.png',
    });

    await expect(
      service.uploadFile({
        filePromise: Promise.resolve({} as any),
        attachmentId: 'attachment-id',
        pageId: 'page-id',
        userId: 'user-id',
        spaceId: 'space-id',
        workspaceId: 'workspace-id',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * Полное совпадение всех инвариантов должно разрешать перезапись.
   */
  it('updates existing attachment when workspaceId, pageId and extension match', async () => {
    attachmentRepo.findById.mockResolvedValue({
      id: 'attachment-id',
      workspaceId: 'workspace-id',
      pageId: 'page-id',
      fileExt: '.drawio',
    });

    await expect(
      service.uploadFile({
        filePromise: Promise.resolve({} as any),
        attachmentId: 'attachment-id',
        pageId: 'page-id',
        userId: 'user-id',
        spaceId: 'space-id',
        workspaceId: 'workspace-id',
      }),
    ).resolves.toMatchObject({ id: 'attachment-id', fileExt: '.drawio' });

    expect(attachmentRepo.updateAttachment).toHaveBeenCalledTimes(1);
  });
});
