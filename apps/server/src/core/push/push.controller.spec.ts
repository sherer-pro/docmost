import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PushController } from './push.controller';

describe('PushController', () => {
  it('is protected by JwtAuthGuard on controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PushController) ?? [];

    expect(guards).toContain(JwtAuthGuard);
  });
});
