import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { DeprecatedRouteInterceptor } from '../../common/interceptors/deprecated-route.interceptor';
import { AttachmentController } from './attachment.controller';

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
