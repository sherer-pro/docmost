import { Readable } from 'node:stream';
import { AttachmentFileAccessService } from './attachment-file-access.service';
import { JwtType } from '../../auth/dto/jwt-payload';

describe('AttachmentFileAccessService', () => {
  const fileId = '11111111-1111-4111-8111-111111111111';
  const pageId = '22222222-2222-4222-8222-222222222222';
  const workspace = { id: 'workspace-1' } as any;
  const attachment = {
    id: fileId,
    workspaceId: workspace.id,
    pageId,
    spaceId: 'space-1',
    filePath: 'workspace-1/files/file.png',
    fileName: 'file.png',
    fileExt: '.png',
    mimeType: 'image/png',
    fileSize: '0',
  } as any;

  function createReply() {
    const headerValues: Record<string, unknown> = {};
    const reply: any = {
      header: jest.fn((name: string, value: unknown) => {
        headerValues[name] = value;
        return reply;
      }),
      headers: jest.fn((values: Record<string, unknown>) => {
        Object.assign(headerValues, values);
        return reply;
      }),
      status: jest.fn(() => reply),
      send: jest.fn((payload?: unknown) => payload),
      headerValues,
    };

    return reply;
  }

  function createService(attachmentOverride: Partial<typeof attachment> = {}) {
    const resolvedAttachment = { ...attachment, ...attachmentOverride };
    const attachmentRepo = {
      findById: jest.fn().mockResolvedValue(resolvedAttachment),
    };
    const tokenService = {
      verifyJwt: jest.fn().mockResolvedValue({
        workspaceId: workspace.id,
        pageId,
        attachmentId: fileId,
      }),
    };
    const storageService = {
      readStream: jest.fn().mockResolvedValue(Readable.from(['ok'])),
    };

    const service = new AttachmentFileAccessService(
      {} as any,
      {} as any,
      {} as any,
      attachmentRepo as any,
      {} as any,
      tokenService as any,
      storageService as any,
    );

    return { attachmentRepo, service, storageService, tokenService };
  }

  it('adds deprecation headers when public access uses legacy jwt query token', async () => {
    const { service, tokenService } = createService();
    const req = { headers: {}, cookies: {} } as any;
    const res = createReply();

    await service.getPublicFile(req, res, workspace, fileId, 'query-token');

    expect(tokenService.verifyJwt).toHaveBeenCalledWith(
      'query-token',
      JwtType.ATTACHMENT,
    );
    expect(res.header).toHaveBeenCalledWith('Deprecation', 'true');
    expect(res.header).toHaveBeenCalledWith(
      'Warning',
      expect.stringContaining('Attachment jwt query tokens are deprecated'),
    );
  });

  it('does not add deprecation headers for header attachment tokens', async () => {
    const { service } = createService();
    const req = {
      headers: { 'x-attachment-token': 'header-token' },
      cookies: {},
    } as any;
    const res = createReply();

    await service.getPublicFile(req, res, workspace, fileId, 'query-token');

    expect(res.header).not.toHaveBeenCalledWith('Deprecation', 'true');
    expect(res.header).not.toHaveBeenCalledWith(
      'Warning',
      expect.stringContaining('Attachment jwt query tokens are deprecated'),
    );
  });

  it('keeps trusted inline image responses inline', async () => {
    const { service } = createService({
      fileExt: '.png',
      fileName: 'image.png',
      mimeType: 'image/png',
    });
    const req = { headers: {}, cookies: {} } as any;
    const res = createReply();

    await service.getPublicFile(req, res, workspace, fileId, 'query-token');

    expect(res.header).not.toHaveBeenCalledWith(
      'Content-Disposition',
      expect.any(String),
    );
    expect(res.headerValues['Content-Type']).toBe('image/png');
  });

  it('serves spoofed inline extensions as downloads with safe content type', async () => {
    const { service } = createService({
      fileExt: '.mp4',
      fileName: 'clip.mp4',
      mimeType: 'text/html',
    });
    const req = { headers: {}, cookies: {} } as any;
    const res = createReply();

    await service.getPublicFile(req, res, workspace, fileId, 'query-token');

    expect(res.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="clip.mp4"',
    );
    expect(res.headerValues['Content-Type']).toBe('application/octet-stream');
  });
});
