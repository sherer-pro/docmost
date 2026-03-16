import { Controller, Get, NotFoundException } from '@nestjs/common';
import { CollaborationGateway } from '../collaboration.gateway';
import { EnvironmentService } from '../../integrations/environment/environment.service';

@Controller('collab')
export class CollaborationController {
  constructor(
    private readonly collaborationGateway: CollaborationGateway,
    private readonly environmentService: EnvironmentService,
  ) {}

  @Get('stats')
  async getStats() {
    if (!this.environmentService.isCollabShowStatsEnabled()) {
      throw new NotFoundException();
    }

    return {
      connections: this.collaborationGateway.getConnectionCount(),
      documents: this.collaborationGateway.getDocumentCount(),
    };
  }
}
