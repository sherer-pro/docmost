import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { DeprecatedRouteInterceptor } from '../../common/interceptors/deprecated-route.interceptor';
import { LegacyFilesController } from './legacy-files.controller';

const ATTACHMENT_LEGACY_ALIAS_SUNSET = 'Fri, 01 Jan 2027 00:00:00 GMT';

function expectDeprecatedRoute(methodName: string, replacement: string) {
  const method = LegacyFilesController.prototype[
    methodName as keyof LegacyFilesController
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

describe('LegacyFilesController', () => {
  const attachmentFileAccessService = {
    getPrivateFile: jest.fn(),
    getPublicFile: jest.fn(),
  };

  const controller = new LegacyFilesController(
    attachmentFileAccessService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    attachmentFileAccessService.getPrivateFile.mockResolvedValue(
      'private-result',
    );
    attachmentFileAccessService.getPublicFile.mockResolvedValue(
      'public-result',
    );
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

  it.each([
    {
      methodName: 'getFile',
      replacement: 'GET /api/attachments/files/:fileId/:fileName',
    },
    {
      methodName: 'getPublicFile',
      replacement: 'GET /api/attachments/files/public/:fileId/:fileName',
    },
  ])(
    'marks $methodName as a deprecated attachment alias',
    ({ methodName, replacement }) => {
      expectDeprecatedRoute(methodName, replacement);
    },
  );
});
