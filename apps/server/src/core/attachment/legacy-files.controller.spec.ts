import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtType } from '../auth/dto/jwt-payload';
import { getAttachmentTokenCookieName } from './attachment-public-token.util';
import { LegacyFilesController } from './legacy-files.controller';

describe('LegacyFilesController public file access', () => {
  const fileId = '11111111-1111-4111-8111-111111111111';
  const workspaceId = 'workspace-1';
  const pageId = 'page-1';

  const attachmentRepo = {
    findById: jest.fn(),
  };
  const tokenService = {
    verifyJwt: jest.fn(),
  };

  const controller = new LegacyFilesController(
    {} as any,
    {} as any,
    {} as any,
    attachmentRepo as any,
    {} as any,
    tokenService as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    attachmentRepo.findById.mockResolvedValue({
      id: fileId,
      workspaceId,
      pageId,
      spaceId: 'space-1',
    });
    tokenService.verifyJwt.mockResolvedValue({
      workspaceId,
      pageId,
      type: JwtType.ATTACHMENT,
    });
    (controller as any).sendFileResponse = jest.fn().mockResolvedValue('ok');
  });

  it('accepts page-scoped cookie token for legacy /files/public URLs', async () => {
    const req = {
      headers: {},
      cookies: {
        [getAttachmentTokenCookieName(pageId)]: 'cookie-token',
      },
    } as any;

    await controller.getPublicFile(
      req,
      {} as any,
      { id: workspaceId } as any,
      fileId,
    );

    expect(tokenService.verifyJwt).toHaveBeenCalledWith(
      'cookie-token',
      JwtType.ATTACHMENT,
    );
    expect((controller as any).sendFileResponse).toHaveBeenCalled();
  });

  it('uses legacy query jwt token when no cookie token is available', async () => {
    const req = {
      headers: {},
      cookies: {},
    } as any;

    await controller.getPublicFile(
      req,
      {} as any,
      { id: workspaceId } as any,
      fileId,
      'query-token',
    );

    expect(tokenService.verifyJwt).toHaveBeenCalledWith(
      'query-token',
      JwtType.ATTACHMENT,
    );
  });

  it('rejects invalid/expired token', async () => {
    tokenService.verifyJwt.mockRejectedValue(new Error('bad token'));

    await expect(
      controller.getPublicFile(
        { headers: {}, cookies: {} } as any,
        {} as any,
        { id: workspaceId } as any,
        fileId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects mismatched attachmentId for attachment-scoped legacy tokens', async () => {
    tokenService.verifyJwt.mockResolvedValue({
      workspaceId,
      pageId,
      attachmentId: '22222222-2222-4222-8222-222222222222',
      type: JwtType.ATTACHMENT,
    });

    await expect(
      controller.getPublicFile(
        { headers: {}, cookies: {} } as any,
        {} as any,
        { id: workspaceId } as any,
        fileId,
        'legacy-token',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
