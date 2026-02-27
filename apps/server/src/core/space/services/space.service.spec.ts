import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { SpaceService } from './space.service';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberService } from './space-member.service';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { LicenseCheckService } from '../../../integrations/environment/license-check.service';
import { QueueName } from '../../../integrations/queue/constants';

describe('SpaceService', () => {
  let service: SpaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: SpaceRepo, useValue: {} },
        { provide: SpaceMemberService, useValue: {} },
        { provide: ShareRepo, useValue: {} },
        { provide: WorkspaceRepo, useValue: {} },
        { provide: LicenseCheckService, useValue: {} },
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
        { provide: getQueueToken(QueueName.ATTACHMENT_QUEUE), useValue: {} },
      ],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
