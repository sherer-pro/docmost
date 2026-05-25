import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { SpaceService } from './space.service';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberService } from './space-member.service';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { LicenseCheckService } from '../../../integrations/environment/license-check.service';
import { QueueName } from '../../../integrations/queue/constants';

describe('SpaceService', () => {
  let service: SpaceService;
  let spaceRepo: {
    slugExists: jest.Mock;
    updateDictionarySettings: jest.Mock;
    updateSpace: jest.Mock;
    archiveSpace: jest.Mock;
    unarchiveSpace: jest.Mock;
  };

  beforeEach(async () => {
    spaceRepo = {
      slugExists: jest.fn(),
      updateDictionarySettings: jest.fn(),
      updateSpace: jest.fn(),
      archiveSpace: jest.fn(),
      unarchiveSpace: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: SpaceRepo, useValue: spaceRepo },
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

  it('updates dictionary setting without replacing other space settings', async () => {
    spaceRepo.updateSpace.mockResolvedValue({
      id: 'space-1',
      settings: {
        documentFields: { status: true },
        dictionary: { enabled: true },
      },
    });

    await service.updateSpace(
      { spaceId: 'space-1', dictionaryEnabled: true },
      'workspace-1',
    );

    expect(spaceRepo.updateDictionarySettings).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
      { enabled: true },
    );
    expect(spaceRepo.updateSpace).toHaveBeenCalledWith(
      { name: undefined, description: undefined, slug: undefined },
      'space-1',
      'workspace-1',
    );
  });

  it('archives a space', async () => {
    const archivedAt = new Date();
    spaceRepo.archiveSpace.mockResolvedValue({
      id: 'space-1',
      archivedAt,
    });

    const space = await service.archiveSpace('space-1', 'workspace-1');

    expect(space.archivedAt).toBe(archivedAt);
    expect(spaceRepo.archiveSpace).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
    );
  });

  it('unarchives a space', async () => {
    spaceRepo.unarchiveSpace.mockResolvedValue({
      id: 'space-1',
      archivedAt: null,
    });

    const space = await service.unarchiveSpace('space-1', 'workspace-1');

    expect(space.archivedAt).toBeNull();
    expect(spaceRepo.unarchiveSpace).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
    );
  });

  it('throws when archived space does not exist', async () => {
    spaceRepo.archiveSpace.mockResolvedValue(undefined);

    await expect(
      service.archiveSpace('space-1', 'workspace-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
