import { LegacyFilesController } from './legacy-files.controller';

describe('LegacyFilesController', () => {
  const attachmentFileAccessService = {
    uploadFile: jest.fn(),
    getPrivateFile: jest.fn(),
    getPublicFile: jest.fn(),
  };

  const controller = new LegacyFilesController(attachmentFileAccessService as any);

  beforeEach(() => {
    jest.clearAllMocks();
    attachmentFileAccessService.uploadFile.mockResolvedValue('upload-result');
    attachmentFileAccessService.getPrivateFile.mockResolvedValue('private-result');
    attachmentFileAccessService.getPublicFile.mockResolvedValue('public-result');
  });

  it('delegates uploadFile to AttachmentFileAccessService', async () => {
    const req = { file: jest.fn() } as any;
    const res = {} as any;
    const user = { id: 'user-1' } as any;
    const workspace = { id: 'workspace-1' } as any;

    const result = await controller.uploadFile(req, res, user, workspace);

    expect(attachmentFileAccessService.uploadFile).toHaveBeenCalledWith(
      req,
      res,
      user,
      workspace,
    );
    expect(result).toBe('upload-result');
  });

  it('delegates getFile to AttachmentFileAccessService', async () => {
    const req = {} as any;
    const res = {} as any;
    const user = { id: 'user-1' } as any;
    const workspace = { id: 'workspace-1' } as any;
    const fileId = '11111111-1111-4111-8111-111111111111';

    const result = await controller.getFile(
      req,
      res,
      user,
      workspace,
      fileId,
      'file-name.txt',
    );

    expect(attachmentFileAccessService.getPrivateFile).toHaveBeenCalledWith(
      req,
      res,
      user,
      workspace,
      fileId,
    );
    expect(result).toBe('private-result');
  });

  it('delegates getPublicFile to AttachmentFileAccessService', async () => {
    const req = { headers: {}, cookies: {} } as any;
    const res = {} as any;
    const workspace = { id: 'workspace-1' } as any;
    const fileId = '11111111-1111-4111-8111-111111111111';
    const jwt = 'public-jwt';

    const result = await controller.getPublicFile(
      req,
      res,
      workspace,
      fileId,
      'file-name.txt',
      jwt,
    );

    expect(attachmentFileAccessService.getPublicFile).toHaveBeenCalledWith(
      req,
      res,
      workspace,
      fileId,
      jwt,
    );
    expect(result).toBe('public-result');
  });
});
