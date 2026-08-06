import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SpaceService } from './space.service';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberService } from './space-member.service';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { QueueName } from '../../../integrations/queue/constants';
import { SpacePolicyService } from '../../space-policy/space-policy.service';
import { SsoEndpointPolicyService } from '../../../integrations/environment/sso-endpoint-policy.service';

describe('SpaceService', () => {
  let service: SpaceService;
  let spaceRepo: {
    slugExists: jest.Mock;
    updateDictionarySettings: jest.Mock;
    updateHeadingNumberingSettings: jest.Mock;
    updateSpace: jest.Mock;
    archiveSpace: jest.Mock;
    unarchiveSpace: jest.Mock;
    findById: jest.Mock;
    deleteSpace: jest.Mock;
  };
  let workspaceRepo: { findById: jest.Mock };
  let shareRepo: { deleteBySpaceId: jest.Mock };
  let ragBindingQuery: {
    select: jest.Mock;
    where: jest.Mock;
    executeTakeFirst: jest.Mock;
  };
  let attachmentQueue: { add: jest.Mock };

  beforeEach(async () => {
    spaceRepo = {
      slugExists: jest.fn(),
      updateDictionarySettings: jest.fn(),
      updateHeadingNumberingSettings: jest.fn(),
      updateSpace: jest.fn(),
      archiveSpace: jest.fn(),
      unarchiveSpace: jest.fn(),
      findById: jest.fn(),
      deleteSpace: jest.fn(),
    };
    workspaceRepo = { findById: jest.fn() };
    shareRepo = { deleteBySpaceId: jest.fn() };
    ragBindingQuery = {
      select: jest.fn(),
      where: jest.fn(),
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
    };
    ragBindingQuery.select.mockReturnValue(ragBindingQuery);
    ragBindingQuery.where.mockReturnValue(ragBindingQuery);
    attachmentQueue = { add: jest.fn() };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (trx: unknown) => unknown) => callback({}),
      })),
      selectFrom: jest.fn().mockReturnValue(ragBindingQuery),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: SpaceRepo, useValue: spaceRepo },
        { provide: SpaceMemberService, useValue: {} },
        { provide: ShareRepo, useValue: shareRepo },
        { provide: WorkspaceRepo, useValue: workspaceRepo },
        SpacePolicyService,
        { provide: SsoEndpointPolicyService, useValue: {} },
        { provide: 'KyselyModuleConnectionToken', useValue: db },
        {
          provide: getQueueToken(QueueName.ATTACHMENT_QUEUE),
          useValue: attachmentQueue,
        },
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

  it('updates heading numbering without replacing other space settings', async () => {
    spaceRepo.updateSpace.mockResolvedValue({
      id: 'space-1',
      settings: {
        dictionary: { enabled: true },
        headingNumbering: { enabled: true },
      },
    });

    await service.updateSpace(
      { spaceId: 'space-1', headingNumberingEnabled: true },
      'workspace-1',
    );

    expect(spaceRepo.updateHeadingNumberingSettings).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
      { enabled: true },
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

  it('blocks deleting a space until RAG Sync cleanup is complete', async () => {
    spaceRepo.findById.mockResolvedValue({
      id: 'space-1',
      workspaceId: 'workspace-1',
    });
    ragBindingQuery.executeTakeFirst.mockResolvedValue({ id: 'binding-1' });

    await expect(
      service.deleteSpace('space-1', 'workspace-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'rag_sync_cleanup_required' }),
    });
    expect(spaceRepo.deleteSpace).not.toHaveBeenCalled();
  });

  it('deletes a space after its RAG Sync binding is clean', async () => {
    const space = { id: 'space-1', workspaceId: 'workspace-1' };
    spaceRepo.findById.mockResolvedValue(space);
    ragBindingQuery.executeTakeFirst.mockResolvedValue(undefined);

    await expect(
      service.deleteSpace('space-1', 'workspace-1'),
    ).resolves.toBeUndefined();
    expect(spaceRepo.deleteSpace).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
    );
    expect(attachmentQueue.add).toHaveBeenCalledWith(
      expect.anything(),
      space,
    );
  });

  it('rejects a space administrator transition that weakens MFA', async () => {
    workspaceRepo.findById.mockResolvedValue({
      enforceMfa: true,
      enforceSso: false,
      settings: {},
    });
    spaceRepo.findById.mockResolvedValue({
      id: 'space-1',
      settings: {},
    });

    await expect(
      service.updateSpace(
        { spaceId: 'space-1', enforceMfa: false },
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an explicit disabled override from a space administrator even when the workspace default is disabled', async () => {
    await expect(
      service.updateSpace(
        { spaceId: 'space-1', enforceMfa: false },
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(workspaceRepo.findById).not.toHaveBeenCalled();
  });

  it('rejects resetting an override from a space administrator', async () => {
    await expect(
      service.updateSpace(
        { spaceId: 'space-1', enforceSso: null },
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(workspaceRepo.findById).not.toHaveBeenCalled();
  });

  it('allows a workspace administrator to set a weaker override', async () => {
    workspaceRepo.findById.mockResolvedValue({
      enforceMfa: true,
      enforceSso: false,
      settings: {},
    });
    spaceRepo.findById.mockResolvedValue({
      id: 'space-1',
      settings: {},
    });
    spaceRepo.updateSpace.mockResolvedValue({ id: 'space-1' });

    await service.updateSpace(
      { spaceId: 'space-1', enforceMfa: false },
      'workspace-1',
      { canLoosenPolicy: true },
    );

    expect(spaceRepo.updateSpace).toHaveBeenCalledWith(
      { settings: { security: { enforceMfa: false } } },
      'space-1',
      'workspace-1',
      expect.anything(),
    );
  });

  it('deletes shares only on an allowed to disabled transition', async () => {
    workspaceRepo.findById.mockResolvedValue({
      enforceMfa: false,
      enforceSso: false,
      settings: { sharing: { disabled: true } },
    });
    spaceRepo.findById.mockResolvedValue({
      id: 'space-1',
      settings: { sharing: { disabled: false } },
    });
    spaceRepo.updateSpace.mockResolvedValue({ id: 'space-1' });

    await service.updateSpace(
      { spaceId: 'space-1', disablePublicSharing: null },
      'workspace-1',
      { canLoosenPolicy: true },
    );

    expect(shareRepo.deleteBySpaceId).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
      expect.anything(),
    );
  });

  it('does not delete links for an explicit allowed override', async () => {
    workspaceRepo.findById.mockResolvedValue({
      enforceMfa: false,
      enforceSso: false,
      settings: { sharing: { disabled: true } },
    });
    spaceRepo.findById.mockResolvedValue({
      id: 'space-1',
      settings: { sharing: { disabled: false } },
    });
    spaceRepo.updateSpace.mockResolvedValue({ id: 'space-1' });

    await service.updateSpace(
      { spaceId: 'space-1', disablePublicSharing: false },
      'workspace-1',
      { canLoosenPolicy: true },
    );

    expect(shareRepo.deleteBySpaceId).not.toHaveBeenCalled();
  });
});
