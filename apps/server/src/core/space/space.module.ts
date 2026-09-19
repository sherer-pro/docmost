import { Module } from '@nestjs/common';
import { SpaceService } from './services/space.service';
import { SpaceController } from './space.controller';
import { SpaceMemberService } from './services/space-member.service';
import { SpaceAdministrationService } from './services/space-administration.service';

@Module({
  imports: [],
  controllers: [SpaceController],
  providers: [SpaceService, SpaceMemberService, SpaceAdministrationService],
  exports: [SpaceService, SpaceMemberService],
})
export class SpaceModule {}
