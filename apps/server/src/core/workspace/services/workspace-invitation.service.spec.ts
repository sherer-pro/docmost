import { createHash } from 'node:crypto';
import { WorkspaceInvitationService } from './workspace-invitation.service';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const INVITATION_ID = '00000000-0000-4000-8000-000000000002';
const INVITER_ID = '00000000-0000-4000-8000-000000000003';
const USER_ID = '00000000-0000-4000-8000-000000000004';

function queryReturning<T>(result: T) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'selectAll', 'where', 'forUpdate']) {
    query[method] = jest.fn(() => query);
  }
  query.execute = jest.fn().mockResolvedValue(result);
  query.executeTakeFirst = jest.fn().mockResolvedValue(result);
  return query;
}

function updateQuery() {
  const query: Record<string, jest.Mock> = {};
  query.set = jest.fn(() => query);
  query.where = jest.fn(() => query);
  query.execute = jest.fn().mockResolvedValue(undefined);
  return query;
}

function deleteQuery() {
  const query: Record<string, jest.Mock> = {};
  query.where = jest.fn(() => query);
  query.execute = jest.fn().mockResolvedValue(undefined);
  return query;
}

function baseDependencies(db: unknown) {
  const userRepo = {
    insertUser: jest.fn(),
  };
  const groupUserRepo = {
    addUserToDefaultGroup: jest.fn().mockResolvedValue(undefined),
  };
  const queueOutbox = {
    enqueueWorkspaceInvitationEmail: jest.fn().mockResolvedValue(undefined),
    enqueueWorkspaceInvitationAcceptedEmail: jest
      .fn()
      .mockResolvedValue(undefined),
    kick: jest.fn(),
  };
  const domainService = {
    getUrl: jest.fn(() => 'https://docs.example.test'),
  };
  const sessionService = {
    createSessionAndToken: jest.fn().mockResolvedValue('session-token'),
  };
  const spacePolicy = {
    resolveInvitationEntrySpace: jest.fn().mockResolvedValue({
      space: { slug: 'general' },
      policy: { effective: { enforceMfa: false } },
    }),
  };

  const service = new WorkspaceInvitationService(
    userRepo as any,
    groupUserRepo as any,
    queueOutbox as any,
    domainService as any,
    sessionService as any,
    spacePolicy as any,
    db as any,
  );

  return {
    service,
    userRepo,
    groupUserRepo,
    queueOutbox,
    sessionService,
  };
}

const workspace = {
  id: WORKSPACE_ID,
  hostname: 'docs',
  emailDomains: null,
  enforceMfa: false,
} as any;

describe('WorkspaceInvitationService outbox boundary', () => {
  it('inserts invitations and encrypted-email tasks in the same transaction', async () => {
    const trx: Record<string, any> = {};
    const existingUsersQuery = queryReturning([]);
    const insertQuery: Record<string, jest.Mock> = {};
    let insertedValues: Array<Record<string, any>> = [];
    insertQuery.values = jest.fn((values) => {
      insertedValues = values;
      return insertQuery;
    });
    insertQuery.onConflict = jest.fn(() => insertQuery);
    insertQuery.returningAll = jest.fn(() => insertQuery);
    insertQuery.execute = jest.fn(async () => [
      {
        id: INVITATION_ID,
        email: 'invitee@example.test',
        tokenHash: insertedValues[0].tokenHash,
      },
    ]);
    trx.selectFrom = jest.fn(() => existingUsersQuery);
    trx.insertInto = jest.fn(() => insertQuery);
    const db = {
      transaction: () => ({ execute: (callback: any) => callback(trx) }),
    };
    const { service, queueOutbox } = baseDependencies(db);

    await service.createInvitation(
      {
        emails: ['invitee@example.test'],
        role: 'member',
      } as any,
      workspace,
      { id: INVITER_ID, name: 'Inviter' } as any,
    );

    expect(queueOutbox.enqueueWorkspaceInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        invitationId: INVITATION_ID,
        inviteeEmail: 'invitee@example.test',
        tokenHash: insertedValues[0].tokenHash,
        inviteToken: expect.any(String),
      }),
      trx,
    );
    const payload =
      queueOutbox.enqueueWorkspaceInvitationEmail.mock.calls[0][0];
    expect(createHash('sha256').update(payload.inviteToken).digest('hex')).toBe(
      payload.tokenHash,
    );
    expect(queueOutbox.kick).toHaveBeenCalledTimes(1);
  });

  it('rotates a resend token and inserts its task under one row lock', async () => {
    const invitationQuery = queryReturning({
      id: INVITATION_ID,
      email: 'invitee@example.test',
      invitedById: INVITER_ID,
    });
    const inviterQuery = queryReturning({ name: 'Inviter' });
    const update = updateQuery();
    const trx = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(invitationQuery)
        .mockReturnValueOnce(inviterQuery),
      updateTable: jest.fn(() => update),
    };
    const db = {
      transaction: () => ({ execute: (callback: any) => callback(trx) }),
    };
    const { service, queueOutbox } = baseDependencies(db);

    await service.resendInvitation(INVITATION_ID, workspace);

    expect(invitationQuery.forUpdate).toHaveBeenCalled();
    expect(update.execute).toHaveBeenCalled();
    expect(queueOutbox.enqueueWorkspaceInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: INVITATION_ID }),
      trx,
    );
    expect(queueOutbox.kick).toHaveBeenCalledTimes(1);
  });

  it('commits the accepted-email task before creating the login session', async () => {
    const rawToken = 'valid-invitation-token';
    const invitation = {
      id: INVITATION_ID,
      email: 'invitee@example.test',
      role: 'member',
      groupIds: null,
      invitedById: INVITER_ID,
      workspaceId: WORKSPACE_ID,
      token: null,
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const invitationQuery = queryReturning(invitation);
    const inviterQuery = queryReturning({ email: 'inviter@example.test' });
    const removeInvitation = deleteQuery();
    const trx = {
      selectFrom: jest.fn(() => inviterQuery),
      deleteFrom: jest.fn(() => removeInvitation),
    };
    const db = {
      selectFrom: jest.fn(() => invitationQuery),
      transaction: () => ({ execute: (callback: any) => callback(trx) }),
    };
    const { service, userRepo, queueOutbox, sessionService } =
      baseDependencies(db);
    userRepo.insertUser.mockResolvedValue({
      id: USER_ID,
      name: 'New user',
      email: 'invitee@example.test',
      workspaceId: WORKSPACE_ID,
    });

    const result = await service.acceptInvitation(
      {
        invitationId: INVITATION_ID,
        token: rawToken,
        name: 'New user',
        password: 'password',
      } as any,
      workspace,
    );

    expect(
      queueOutbox.enqueueWorkspaceInvitationAcceptedEmail,
    ).toHaveBeenCalledWith(
      {
        invitationId: INVITATION_ID,
        acceptedUserId: USER_ID,
        recipientEmail: 'inviter@example.test',
        invitedUserName: 'New user',
        invitedUserEmail: 'invitee@example.test',
      },
      trx,
    );
    expect(removeInvitation.execute).toHaveBeenCalled();
    expect(sessionService.createSessionAndToken).toHaveBeenCalled();
    expect(result).toEqual({
      authToken: 'session-token',
      entrySpaceSlug: 'general',
    });
  });
});
