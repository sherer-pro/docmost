import { Module } from '@nestjs/common';
import { WorkspaceService } from './services/workspace.service';
import { WorkspaceController } from './controllers/workspace.controller';
import { SpaceModule } from '../space/space.module';
import { WorkspaceInvitationService } from './services/workspace-invitation.service';
import { SessionModule } from '../session/session.module';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [SpaceModule, SessionModule, PresenceModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceInvitationService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
