jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));
import { NotFoundException } from '@nestjs/common';
import { PageTemplateService } from './page-template.service';

const user = {
  id: '019fdaa0-0000-7000-8000-000000000010',
  workspaceId: '019fdaa0-0000-7000-8000-000000000020',
} as any;
const sourceSpaceId = '019fdaa0-0000-7000-8000-000000000030';
const targetSpaceId = '019fdaa0-0000-7000-8000-000000000040';
const sourcePageId = '019fdaa0-0000-7000-8000-000000000050';
const consumerPageId = '019fdaa0-0000-7000-8000-000000000060';

function buildService(options?: {
  db?: any;
  pageRepo?: any;
  pageService?: any;
  pageAccessService?: any;
  spaceAbility?: any;
  policy?: any;
}) {
  const pageRepo = options?.pageRepo ?? { findById: jest.fn() };
  const pageService = options?.pageService ?? { create: jest.fn() };
  const pageAccessService = options?.pageAccessService ?? {};
  const spaceAbility =
    options?.spaceAbility ??
    ({
      createForUser: jest.fn(async () => ({
        can: () => true,
        cannot: () => false,
      })),
    } as any);
  const policy =
    options?.policy ??
    ({ assertAction: jest.fn(), resolveForUser: jest.fn() } as any);
  const service = new PageTemplateService(
    options?.db ?? ({} as any),
    pageRepo,
    pageService,
    pageAccessService,
    spaceAbility,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    policy,
    {} as any,
    {} as any,
  );
  return {
    service,
    pageRepo,
    pageService,
    pageAccessService,
    spaceAbility,
    policy,
  };
}

describe('PageTemplateService space boundaries', () => {
  it('returns disabled discovery capabilities without querying pages', async () => {
    const policy = {
      resolveForUser: jest.fn(async () => ({
        systemEnabled: true,
        workspaceEnabled: true,
        templatesEnabled: false,
        allowCreateTemplate: true,
        allowSnapshot: true,
        allowLiveEmbed: true,
        allowedActions: ['create_template', 'use_snapshot', 'use_live_embed'],
      })),
    };
    const { service } = buildService({ policy });

    await expect(
      service.discover({ spaceId: sourceSpaceId, limit: 20 }, user),
    ).resolves.toEqual({
      items: [],
      nextCursor: null,
      capabilities: {
        enabled: false,
        createTemplate: false,
        useSnapshot: false,
        useLiveEmbed: false,
      },
    });
  });

  it('creates a blank root template through PageService', async () => {
    const createdPage = { id: sourcePageId, spaceId: sourceSpaceId };
    const pageService = { create: jest.fn(async () => createdPage) };
    const { service, policy } = buildService({ pageService });

    await expect(
      service.createTemplate({ spaceId: sourceSpaceId }, user),
    ).resolves.toEqual({ page: createdPage });
    expect(policy.assertAction).toHaveBeenCalledWith(
      user.workspaceId,
      sourceSpaceId,
      user.id,
      'create_template',
    );
    expect(pageService.create).toHaveBeenCalledWith(
      user.id,
      user.workspaceId,
      { spaceId: sourceSpaceId, title: undefined },
      { isTemplate: true },
    );
  });

  it('rejects cross-space snapshots before checking destination policy', async () => {
    const { service, policy } = buildService();
    jest
      .spyOn(service as any, 'findCompletedOperation')
      .mockResolvedValue(null);
    jest.spyOn(service as any, 'requireTemplateSource').mockResolvedValue({
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      isTemplate: true,
    });

    await expect(
      service.createFromTemplate(
        { templatePageId: sourcePageId, spaceId: targetSpaceId },
        'snapshot-key',
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(policy.assertAction).not.toHaveBeenCalled();
  });

  it('rejects cross-space live embeds before mutating the consumer', async () => {
    const { service, policy } = buildService();
    jest
      .spyOn(service as any, 'findCompletedOperation')
      .mockResolvedValue(null);
    jest.spyOn(service as any, 'requirePlainDocument').mockResolvedValueOnce({
      id: consumerPageId,
      workspaceId: user.workspaceId,
      spaceId: targetSpaceId,
    });
    jest.spyOn(service as any, 'requireTemplateSource').mockResolvedValue({
      id: sourcePageId,
      workspaceId: user.workspaceId,
      spaceId: sourceSpaceId,
      isTemplate: true,
    });

    await expect(
      service.insertPageEmbed(
        {
          consumerPageId,
          sourcePageId,
          from: 1,
          to: 1,
          baseContentHash: 'a'.repeat(64),
        },
        'embed-key',
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(policy.assertAction).not.toHaveBeenCalled();
  });

  it('returns only destinations where child creation is allowed', async () => {
    const query: any = {};
    for (const method of ['select', 'where', 'orderBy', 'limit']) {
      query[method] = jest.fn(() => query);
    }
    query.execute = jest.fn(async () => [{ id: 'allowed' }, { id: 'denied' }]);
    const db = { selectFrom: jest.fn(() => query) };
    const pages = {
      allowed: {
        id: 'allowed',
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
        slugId: 'allowed-slug',
        title: 'Allowed',
        icon: null,
        parentPageId: null,
        deletedAt: null,
      },
      denied: {
        id: 'denied',
        workspaceId: user.workspaceId,
        spaceId: sourceSpaceId,
        slugId: 'denied-slug',
        title: 'Denied',
        icon: null,
        parentPageId: null,
        deletedAt: null,
      },
    };
    const pageRepo = {
      findById: jest.fn(async (id: 'allowed' | 'denied') => pages[id]),
    };
    const pageAccessService = {
      getEffectiveAccessForPages: jest.fn(
        async () =>
          new Map([
            ['allowed', { capabilities: { canCreateChild: true } }],
            ['denied', { capabilities: { canCreateChild: false } }],
          ]),
      ),
    };
    const { service } = buildService({ db, pageRepo, pageAccessService });

    await expect(
      service.listDestinations({ spaceId: sourceSpaceId, limit: 20 }, user),
    ).resolves.toMatchObject({
      rootAllowed: true,
      items: [{ id: 'allowed' }],
    });
  });
});
