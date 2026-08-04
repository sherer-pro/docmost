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
});
