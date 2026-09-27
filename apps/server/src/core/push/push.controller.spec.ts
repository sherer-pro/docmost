import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PushController } from './push.controller';

describe('Push subscription admission', () => {
  it('is protected by JwtAuthGuard on controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PushController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });
  const user = { id: 'owner', workspaceId: 'workspace' } as any;
  const dto = {
    endpoint: 'https://push.example.test/send/device',
    keys: { p256dh: 'key', auth: 'auth' },
  };
  it('rejects a forbidden endpoint before any persistence', async () => {
    const repo = { upsert: jest.fn() };
    const policy = {
      assertAllowed: jest.fn().mockRejectedValue(new BadRequestException()),
    };
    const controller = new PushController(
      repo as any,
      {} as any,
      policy as any,
    );
    await expect(
      controller.createSubscription(dto, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it('keeps the owner and existing browser key formats', async () => {
    const repo = { upsert: jest.fn(async () => ({ id: 'subscription' })) };
    const policy = { assertAllowed: jest.fn().mockResolvedValue(undefined) };
    const controller = new PushController(
      repo as any,
      {} as any,
      policy as any,
    );
    await expect(controller.createSubscription(dto, user)).resolves.toEqual({
      id: 'subscription',
    });
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: dto.endpoint,
        userId: user.id,
        workspaceId: user.workspaceId,
        ...dto.keys,
      }),
    );
    expect(policy.assertAllowed).toHaveBeenCalledWith(dto.endpoint);
  });
});
