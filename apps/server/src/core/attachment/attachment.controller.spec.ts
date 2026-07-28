import { BadRequestException } from '@nestjs/common';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { DeprecatedRouteInterceptor } from '../../common/interceptors/deprecated-route.interceptor';
import { AttachmentController } from './attachment.controller';
import { AttachmentType } from './attachment.constants';

const ATTACHMENT_LEGACY_ALIAS_SUNSET = 'Fri, 01 Jan 2027 00:00:00 GMT';

function expectDeprecatedRoute(methodName: string, replacement: string) {
  const method = AttachmentController.prototype[
    methodName as keyof AttachmentController
  ] as (...args: unknown[]) => unknown;
  const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, method) ?? [];
  const deprecatedRouteInterceptor = interceptors.find(
    (interceptor: unknown) => interceptor instanceof DeprecatedRouteInterceptor,
  );

  expect(deprecatedRouteInterceptor).toBeInstanceOf(DeprecatedRouteInterceptor);
  expect((deprecatedRouteInterceptor as any).options).toEqual({
    sunset: ATTACHMENT_LEGACY_ALIAS_SUNSET,
    replacement,
  });
}

describe('AttachmentController legacy aliases', () => {
  const controller = new AttachmentController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates the legacy upload-image alias to the canonical action', async () => {
    const spy = jest
      .spyOn(controller, 'uploadAvatarOrLogo')
      .mockResolvedValue(undefined);
    const req = { file: jest.fn() } as any;
    const res = {} as any;
    const user = { id: 'user-1' } as any;
    const workspace = { id: 'workspace-1' } as any;

    await controller.uploadAvatarOrLogoLegacy(req, res, user, workspace);

    expect(spy).toHaveBeenCalledWith(req, res, user, workspace);
  });

  it('delegates the legacy remove-icon alias to the canonical action', async () => {
    const spy = jest
      .spyOn(controller, 'removeIcon')
      .mockResolvedValue(undefined);
    const dto = { type: 'avatar' } as any;
    const user = { id: 'user-1' } as any;
    const workspace = { id: 'workspace-1' } as any;

    await controller.removeIconLegacy(dto, user, workspace);

    expect(spy).toHaveBeenCalledWith(dto, user, workspace);
  });

  it.each([
    {
      methodName: 'uploadAvatarOrLogoLegacy',
      replacement: 'POST /api/attachments/actions/upload-image',
    },
    {
      methodName: 'removeIconLegacy',
      replacement: 'POST /api/attachments/actions/remove-icon',
    },
  ])(
    'marks $methodName as a deprecated attachment alias',
    ({ methodName, replacement }) => {
      expectDeprecatedRoute(methodName, replacement);
    },
  );
});

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
