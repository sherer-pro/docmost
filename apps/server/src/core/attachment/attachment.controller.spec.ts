import { BadRequestException } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';
import { AttachmentType } from './attachment.constants';

describe('AttachmentController image path resolution', () => {
  const fileId = '018f4f6a-6f5a-7f2c-9c0d-1f2a3b4c5d6e';
  const workspace = { id: 'workspace-1' } as any;

  function createController() {
    const readStream = jest.fn().mockResolvedValue('stream');
    const controller = new AttachmentController(
      {} as any,
      {} as any,
      { readStream } as any,
      {} as any,
      {} as any,
    );

    return { controller, readStream };
  }

  function createReply() {
    return { headers: jest.fn(), send: jest.fn() } as any;
  }

  it('resolves the storage path from the validated file id only', async () => {
    const { controller, readStream } = createController();

    await controller.getLogoOrAvatar(
      createReply(),
      workspace,
      AttachmentType.Avatar,
      `${fileId}.png`,
    );

    expect(readStream).toHaveBeenCalledWith(
      `workspace-1/avatars/${fileId}.png`,
    );
  });

  it('never leaves the workspace folder when the file name carries path separators', async () => {
    const { controller, readStream } = createController();

    // Route params can still arrive with decoded separators (`%2F`), so the raw
    // value must never reach the storage path.
    await controller.getLogoOrAvatar(
      createReply(),
      workspace,
      AttachmentType.Avatar,
      `../../other-workspace/avatars/${fileId}.png`,
    );

    expect(readStream).toHaveBeenCalledWith(
      `workspace-1/avatars/${fileId}.png`,
    );
    expect(readStream).not.toHaveBeenCalledWith(
      expect.stringContaining('other-workspace'),
    );
  });

  it('rejects file names outside the allowed image extensions', async () => {
    const { controller, readStream } = createController();

    await expect(
      controller.getLogoOrAvatar(
        createReply(),
        workspace,
        AttachmentType.Avatar,
        `${fileId}.svg`,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(readStream).not.toHaveBeenCalled();
  });

  it('rejects file names whose id is not a uuid', async () => {
    const { controller, readStream } = createController();

    await expect(
      controller.getLogoOrAvatar(
        createReply(),
        workspace,
        AttachmentType.Avatar,
        'not-a-uuid.png',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(readStream).not.toHaveBeenCalled();
  });
});
