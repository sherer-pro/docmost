import { ConflictException } from '@nestjs/common';
import { AiContextService } from './ai-context.service';

describe('AiContextService revisions', () => {
  const user = { id: 'user' } as any;
  const workspace = { id: 'workspace' } as any;
  const dto = {
    expectedRevision: 3,
    includeCurrentDocument: true,
    sources: [],
    fileIds: [],
    attachmentIds: [],
  };

  function createService(lockedOverrides: Record<string, unknown> = {}) {
    const conversation = {
      id: 'conversation',
      userId: user.id,
      workspaceId: workspace.id,
      spaceId: 'space',
      pageId: 'page',
      includeCurrentDocument: true,
      contextRevision: 3,
      contextFingerprint: '',
      contextChatFileIds: [],
      contextAttachmentIds: [],
      updatedAt: new Date('2026-07-29T12:00:00.000Z'),
      ...lockedOverrides,
    };
    const sourceListQuery: any = {
      selectAll: jest.fn(() => sourceListQuery),
      where: jest.fn(() => sourceListQuery),
      orderBy: jest.fn(() => sourceListQuery),
      execute: jest.fn(async () => []),
    };
    const lockedQuery: any = {
      selectAll: jest.fn(() => lockedQuery),
      where: jest.fn(() => lockedQuery),
      forUpdate: jest.fn(() => lockedQuery),
      executeTakeFirst: jest.fn(async () => conversation),
    };
    const trx = {
      selectFrom: jest.fn(() => lockedQuery),
      deleteFrom: jest.fn(),
      updateTable: jest.fn(),
    };
    const db = {
      selectFrom: jest.fn(() => sourceListQuery),
      transaction: jest.fn(() => ({
        execute: (callback: (value: typeof trx) => unknown) => callback(trx),
      })),
    };
    const service = new AiContextService(
      db as any,
      { getOwnedEntity: jest.fn(async () => conversation) } as any,
      {} as any,
      {} as any,
    );
    return { service, conversation, trx };
  }

  it('returns the current context for an identical repeated update', async () => {
    const { service, conversation, trx } = createService();
    conversation.contextFingerprint = (service as any).fingerprint({
      includeCurrentDocument: true,
      sources: [],
      fileIds: [],
      attachmentIds: [],
    });

    await expect(
      service.update('conversation', dto as any, user, workspace),
    ).resolves.toMatchObject({
      revision: 3,
      includeCurrentDocument: true,
    });
    expect(trx.deleteFrom).not.toHaveBeenCalled();
    expect(trx.updateTable).not.toHaveBeenCalled();
  });

  it('rejects a conflicting stale revision', async () => {
    const { service, trx } = createService({
      contextRevision: 4,
      contextFingerprint: 'different',
    });

    await expect(
      service.update('conversation', dto as any, user, workspace),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(trx.deleteFrom).not.toHaveBeenCalled();
  });
});
