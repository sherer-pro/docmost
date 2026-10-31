import { createHmac } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { encryptProtectedValue } from '../../common/security/credential-protection.util';
import { IntegrationPreviewService } from './integration-preview.service';

describe('integration preview authorization and private cache', () => {
  const user = {
    id: 'viewer-a',
    workspaceId: 'workspace-a',
    role: 'member',
  } as any;
  const secret = 'synthetic-secret-with-more-than-32-characters';
  const url = 'https://github.com/private/project/issues/1';
  let current: any;
  let service: IntegrationPreviewService;
  const http = {
    read: jest.fn(),
    availableProviders: () => ['github', 'gitlab', 'figma'],
  };
  const access = { assertCanReadPage: jest.fn() };
  const pages = { findById: jest.fn() };
  const update = { set: jest.fn(), where: jest.fn(), execute: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    for (const name of ['set', 'where']) update[name].mockReturnValue(update);
    update.execute.mockResolvedValue([]);
    pages.findById.mockResolvedValue({
      id: 'page-a',
      workspaceId: user.workspaceId,
    });
    access.assertCanReadPage.mockResolvedValue(undefined);
    service = new IntegrationPreviewService(
      { updateTable: () => update } as any,
      { getAppSecret: () => secret } as any,
      http as any,
      pages as any,
      access as any,
    );
    jest.spyOn(service, 'settings').mockResolvedValue({
      enabled: true,
      availableProviders: ['github', 'gitlab', 'figma'],
    });
    current = null;
    jest
      .spyOn(service as any, 'connection')
      .mockImplementation(async () => current);
    http.read.mockResolvedValue({
      status: 200,
      data: { title: 'Private title', state: 'open' },
      etag: '"v1"',
    });
  });
  const connect = () => {
    const key = createHmac('sha256', secret)
      .update(
        `integration-preview:v1:${user.workspaceId}:${user.id}:connection-a`,
      )
      .digest('hex');
    current = {
      id: 'connection-a',
      revision: 1,
      credential: encryptProtectedValue('synthetic-token', key),
    };
  };
  it('revalidates a private ETag with the provider and forgets cached metadata after external revocation', async () => {
    connect();
    expect((await service.resolve(user, 'page-a', url)).title).toBe(
      'Private title',
    );
    http.read.mockResolvedValueOnce({ status: 304, data: null, etag: null });
    expect((await service.resolve(user, 'page-a', url)).title).toBe(
      'Private title',
    );
    expect(http.read).toHaveBeenLastCalledWith(
      expect.anything(),
      'synthetic-token',
      '"v1"',
    );
    http.read.mockResolvedValueOnce({ status: 403, data: null, etag: null });
    expect(await service.resolve(user, 'page-a', url)).toEqual(
      expect.objectContaining({ status: 'unavailable' }),
    );
    http.read.mockRejectedValueOnce(new Error('provider offline'));
    expect(
      JSON.stringify(await service.resolve(user, 'page-a', url)),
    ).not.toContain('Private title');
  });
  it.each(['disconnect', 'rotate', 'disable', 'page-denied'])(
    'discards an in-flight private result on %s',
    async (change) => {
      connect();
      http.read.mockImplementationOnce(async () => {
        if (change === 'disconnect') current = null;
        if (change === 'rotate') current = { ...current, revision: 2 };
        if (change === 'disable')
          jest.mocked(service.settings).mockResolvedValue({
            enabled: false,
            availableProviders: ['github'],
          });
        if (change === 'page-denied')
          access.assertCanReadPage.mockRejectedValue(new ForbiddenException());
        return {
          status: 200,
          data: { title: 'In-flight private title' },
          etag: null,
        };
      });
      if (change === 'page-denied')
        await expect(
          service.resolve(user, 'page-a', url),
        ).rejects.toBeInstanceOf(ForbiddenException);
      else
        expect(await service.resolve(user, 'page-a', url)).toMatchObject({
          status: 'unavailable',
        });
    },
  );
  it('rejects copied ciphertext under another viewer and never sends it to the provider', async () => {
    connect();
    expect(
      await service.resolve({ ...user, id: 'viewer-b' }, 'page-a', url),
    ).toMatchObject({ status: 'unavailable' });
    expect(http.read).not.toHaveBeenCalled();
  });
  it('does not make any outbound request before current page access succeeds', async () => {
    access.assertCanReadPage.mockRejectedValue(new ForbiddenException());
    await expect(service.resolve(user, 'page-a', url)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(http.read).not.toHaveBeenCalled();
  });
  it('does not reuse a public cache entry for another viewer', async () => {
    await service.resolve(user, 'page-a', url);
    await service.resolve(user, 'page-a', url);
    expect(http.read).toHaveBeenCalledTimes(1);
    await service.resolve({ ...user, id: 'viewer-b' }, 'page-a', url);
    expect(http.read).toHaveBeenCalledTimes(2);
  });
  it('bounds concurrent provider reads for one viewer and releases every slot', async () => {
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    http.read.mockImplementation(async () => {
      started++;
      await gate;
      return { status: 200, data: { title: 'Metadata' }, etag: null };
    });
    const pending = Array.from({ length: 8 }, (_, i) =>
      service.resolve(user, 'page-a', `${url}#item-${i}`),
    );
    for (let i = 0; started < 8 && i < 100; i++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(started).toBe(8);
    expect(
      await service.resolve(user, 'page-a', `${url}#overflow`),
    ).toMatchObject({ status: 'rateLimited' });
    release!();
    await Promise.all(pending);
    expect(await service.resolve(user, 'page-a', `${url}#after`)).toMatchObject(
      { status: 'ready' },
    );
  });
});
