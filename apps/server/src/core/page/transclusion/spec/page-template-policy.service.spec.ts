import { PageTemplatePolicyService } from '../page-template-policy.service';

function fluent(executeTakeFirst: () => Promise<unknown>) {
  const query: any = {
    values: jest.fn(() => query),
    set: jest.fn(() => query),
    where: jest.fn(() => query),
    returning: jest.fn(() => query),
    onConflict: jest.fn((callback: (builder: any) => unknown) => {
      const conflict: any = {
        column: jest.fn(() => conflict),
        doNothing: jest.fn(() => conflict),
      };
      callback(conflict);
      return query;
    }),
    executeTakeFirst: jest.fn(executeTakeFirst),
  };
  return query;
}

describe('PageTemplatePolicyService optimistic revisions', () => {
  const environment = {
    isPageTemplatesEnabled: () => true,
    getMaxPageEmbedDepth: () => 5,
  };
  const eventEmitter = { emit: jest.fn() };

  it('returns HTTP 409 when a concurrent update wins the expected revision', async () => {
    const update = fluent(async () => undefined);
    const service = new PageTemplatePolicyService(
      { updateTable: jest.fn(() => update) } as any,
      environment as any,
      eventEmitter as any,
    );

    await expect(
      service.updateWorkspacePolicy({
        workspaceId: 'workspace',
        userId: 'user',
        enabled: true,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_template_policy_revision_conflict',
      }),
    });
    expect(update.where).toHaveBeenCalledWith('revision', '=', 2);
  });

  it('returns HTTP 409 when concurrent revision-zero inserts conflict', async () => {
    const insert = fluent(async () => undefined);
    const service = new PageTemplatePolicyService(
      { insertInto: jest.fn(() => insert) } as any,
      environment as any,
      eventEmitter as any,
    );

    await expect(
      service.updateWorkspacePolicy({
        workspaceId: 'workspace',
        userId: 'user',
        enabled: true,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'page_template_policy_revision_conflict',
      }),
    });
  });

  it('includes inherited deployment and workspace gates in a space policy', async () => {
    const query: any = {};
    for (const method of ['selectAll', 'where']) {
      query[method] = jest.fn(() => query);
    }
    query.executeTakeFirst = jest.fn().mockResolvedValue({
      templatesEnabled: true,
      allowCreateTemplate: true,
      allowRegularTemplate: true,
      allowSyncedTemplate: false,
      revision: 3,
    });
    const service = new PageTemplatePolicyService(
      { selectFrom: jest.fn(() => query) } as any,
      environment as any,
      eventEmitter as any,
    );
    jest.spyOn(service, 'getWorkspacePolicy').mockResolvedValue({
      enabled: false,
      revision: 2,
      systemEnabled: true,
    });

    await expect(service.getSpacePolicy('workspace', 'space')).resolves.toEqual(
      {
        spaceId: 'space',
        systemEnabled: true,
        workspaceEnabled: false,
        templatesEnabled: true,
        allowCreateTemplate: true,
        allowRegularTemplate: true,
        allowSyncedTemplate: false,
        revision: 3,
      },
    );
  });

  it('lists active space member groups with a stable cursor', async () => {
    const query: any = {};
    for (const method of ['innerJoin', 'select', 'where', 'orderBy', 'limit']) {
      query[method] = jest.fn(() => query);
    }
    query.execute = jest.fn().mockResolvedValue([
      {
        id: 'group-1',
        name: 'Design',
        description: 'Designers',
        isDefault: false,
        memberCount: '4',
      },
      {
        id: 'group-2',
        name: 'Everyone',
        description: null,
        isDefault: true,
        memberCount: '10',
      },
      {
        id: 'group-3',
        name: 'Support',
        description: null,
        isDefault: false,
        memberCount: '2',
      },
    ]);
    const service = new PageTemplatePolicyService(
      { selectFrom: jest.fn(() => query) } as any,
      environment as any,
      eventEmitter as any,
    );

    const result = await service.listPolicyGroups('workspace', 'space', {
      limit: 2,
    });

    expect(result.items).toEqual([
      {
        id: 'group-1',
        name: 'Design',
        description: 'Designers',
        isDefault: false,
        memberCount: 4,
      },
      {
        id: 'group-2',
        name: 'Everyone',
        description: null,
        isDefault: true,
        memberCount: 10,
      },
    ]);
    expect(
      JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString('utf8')),
    ).toEqual({
      version: 1,
      type: 'page_template_policy_group',
      name: 'Everyone',
      id: 'group-2',
    });
    expect(query.where).toHaveBeenCalledWith(
      'policyGroup.workspaceId',
      '=',
      'workspace',
    );
    expect(query.innerJoin).toHaveBeenCalledWith(
      'spaceMembers as policyMembership',
      expect.any(Function),
    );
  });

  it('rejects malformed policy-group cursors before querying groups', async () => {
    const db = { selectFrom: jest.fn() };
    const service = new PageTemplatePolicyService(
      db as any,
      environment as any,
      eventEmitter as any,
    );

    await expect(
      service.listPolicyGroups('workspace', 'space', {
        cursor: Buffer.from(
          JSON.stringify({ version: 2, type: 'page_template_policy_group' }),
        ).toString('base64url'),
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'page_template_cursor_invalid',
      }),
    });
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it('does not expose a stored override for a group without an active space membership', async () => {
    const query: any = {};
    for (const method of ['innerJoin', 'leftJoin', 'select', 'where']) {
      query[method] = jest.fn(() => query);
    }
    query.executeTakeFirst = jest.fn().mockResolvedValue(undefined);
    const service = new PageTemplatePolicyService(
      { selectFrom: jest.fn(() => query) } as any,
      environment as any,
      eventEmitter as any,
    );

    await expect(
      service.getGroupPolicy('workspace', 'space', 'unrelated-group'),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'page_template_policy_group_not_in_space',
      }),
    });
    expect(query.innerJoin).toHaveBeenCalledWith(
      'spaceMembers as policyMembership',
      expect.any(Function),
    );
  });

  it('rejects an override update before writing when the group membership is inactive', async () => {
    const activeGroupQuery: any = {};
    for (const method of ['innerJoin', 'select', 'where', 'forUpdate']) {
      activeGroupQuery[method] = jest.fn(() => activeGroupQuery);
    }
    activeGroupQuery.executeTakeFirst = jest.fn().mockResolvedValue(undefined);
    const trx = {
      selectFrom: jest.fn(() => activeGroupQuery),
      insertInto: jest.fn(),
      updateTable: jest.fn(),
    };
    const transactionBuilder = {
      execute: jest.fn((callback: (value: any) => Promise<unknown>) =>
        callback(trx),
      ),
    };
    const service = new PageTemplatePolicyService(
      { transaction: jest.fn(() => transactionBuilder) } as any,
      environment as any,
      eventEmitter as any,
    );

    await expect(
      service.updateGroupPolicy({
        workspaceId: 'workspace',
        spaceId: 'space',
        groupId: 'unrelated-group',
        userId: 'admin',
        expectedRevision: 0,
        allowedActions: [],
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'page_template_policy_group_not_in_space',
      }),
    });
    expect(activeGroupQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(trx.insertInto).not.toHaveBeenCalled();
    expect(trx.updateTable).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('intersects every explicit group action allowlist', async () => {
    const query: any = {
      innerJoin: jest.fn(() => query),
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      execute: jest.fn(async () => [
        {
          allowedActions: [
            'create_template',
            'manage_template',
            'use_regular_template',
          ],
        },
        { allowedActions: ['use_regular_template', 'use_synced_template'] },
      ]),
    };
    const service = new PageTemplatePolicyService(
      { selectFrom: jest.fn(() => query) } as any,
      environment as any,
      eventEmitter as any,
    );
    jest.spyOn(service as any, 'readBasePolicy').mockResolvedValue({
      systemEnabled: true,
      workspaceEnabled: true,
      templatesEnabled: true,
      allowCreateTemplate: true,
      allowRegularTemplate: true,
      allowSyncedTemplate: true,
    });
    jest.spyOn(service, 'isPolicyAdministrator').mockResolvedValue(false);

    await expect(
      service.resolveForUser('workspace', 'space', 'user'),
    ).resolves.toMatchObject({ allowedActions: ['use_regular_template'] });
  });

  it('ignores a deny override from a group without an active space membership', async () => {
    let scopedToActiveSpaceGroups = false;
    const query: any = {
      innerJoin: jest.fn((table: string) => {
        if (table === 'spaceMembers as policyMembership') {
          scopedToActiveSpaceGroups = true;
        }
        return query;
      }),
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      execute: jest.fn(async () =>
        scopedToActiveSpaceGroups
          ? [{ allowedActions: ['use_regular_template'] }]
          : [
              { allowedActions: ['use_regular_template'] },
              { allowedActions: [] },
            ],
      ),
    };
    const service = new PageTemplatePolicyService(
      { selectFrom: jest.fn(() => query) } as any,
      environment as any,
      eventEmitter as any,
    );
    jest.spyOn(service as any, 'readBasePolicy').mockResolvedValue({
      systemEnabled: true,
      workspaceEnabled: true,
      templatesEnabled: true,
      allowCreateTemplate: true,
      allowRegularTemplate: true,
      allowSyncedTemplate: true,
    });
    jest.spyOn(service, 'isPolicyAdministrator').mockResolvedValue(false);

    await expect(
      service.resolveForUser('workspace', 'space', 'user'),
    ).resolves.toMatchObject({ allowedActions: ['use_regular_template'] });
    expect(query.innerJoin).toHaveBeenCalledWith(
      'spaceMembers as policyMembership',
      expect.any(Function),
    );
    expect(query.where).toHaveBeenCalledWith(
      'policyGroup.workspaceId',
      '=',
      'workspace',
    );
    expect(query.where).toHaveBeenCalledWith(
      'policyGroup.deletedAt',
      'is',
      null,
    );
  });

  it('denies an action when any base policy gate is closed', async () => {
    const query: any = {
      innerJoin: jest.fn(() => query),
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      execute: jest.fn(async () => []),
    };
    const service = new PageTemplatePolicyService(
      { selectFrom: jest.fn(() => query) } as any,
      environment as any,
      eventEmitter as any,
    );
    jest.spyOn(service as any, 'readBasePolicy').mockResolvedValue({
      systemEnabled: true,
      workspaceEnabled: true,
      templatesEnabled: true,
      allowCreateTemplate: true,
      allowRegularTemplate: false,
      allowSyncedTemplate: true,
    });
    jest.spyOn(service, 'isPolicyAdministrator').mockResolvedValue(false);

    await expect(
      service.assertAction(
        'workspace',
        'space',
        'user',
        'use_regular_template',
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'page_template_policy_denied',
      }),
    });
  });

  it('lets policy administrators bypass group intersections only', async () => {
    const service = new PageTemplatePolicyService(
      {
        selectFrom: jest.fn(() => Promise.reject(new Error('unexpected'))),
      } as any,
      environment as any,
      eventEmitter as any,
    );
    jest.spyOn(service as any, 'readBasePolicy').mockResolvedValue({
      systemEnabled: true,
      workspaceEnabled: true,
      templatesEnabled: true,
      allowCreateTemplate: true,
      allowRegularTemplate: false,
      allowSyncedTemplate: true,
    });
    jest.spyOn(service, 'isPolicyAdministrator').mockResolvedValue(true);

    await expect(
      service.resolveForUser('workspace', 'space', 'admin'),
    ).resolves.toMatchObject({
      allowedActions: [
        'create_template',
        'manage_template',
        'use_regular_template',
        'use_synced_template',
      ],
    });
    await expect(
      service.assertAction(
        'workspace',
        'space',
        'admin',
        'use_regular_template',
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'page_template_policy_denied',
      }),
    });
  });

  it.each([
    ['owner', { role: 'owner' }, undefined],
    ['workspace admin', { role: 'admin' }, undefined],
    ['space admin', { role: 'member' }, { id: 'membership' }],
  ])(
    'recognizes a %s as a policy administrator',
    async (_label, user, membership) => {
      const queryFor = (result: unknown) => {
        const query: any = {};
        for (const method of ['select', 'where', 'innerJoin', 'leftJoin']) {
          query[method] = jest.fn(() => query);
        }
        query.executeTakeFirst = jest.fn().mockResolvedValue(result);
        return query;
      };
      const db = {
        selectFrom: jest.fn((table: string) =>
          table === 'users' ? queryFor(user) : queryFor(membership),
        ),
      };
      const service = new PageTemplatePolicyService(
        db as any,
        environment as any,
        eventEmitter as any,
      );

      await expect(
        service.isPolicyAdministrator('workspace', 'space', 'user'),
      ).resolves.toBe(true);
    },
  );
});
