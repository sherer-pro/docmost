import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AcceptInviteDto, InviteUserDto } from '../dto/invitation.dto';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';
import { executeTx } from '@docmost/db/utils';
import {
  Group,
  User,
  Workspace,
  WorkspaceInvitation,
} from '@docmost/db/types/entity.types';
import { MailService } from '../../../integrations/mail/mail.service';
import InvitationEmail from '@docmost/transactional/emails/invitation-email';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import InvitationAcceptedEmail from '@docmost/transactional/emails/invitation-accepted-email';
import { SessionService } from '../../session/session.service';
import { nanoIdGen } from '../../../common/helpers';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { DomainService } from '../../../integrations/environment/domain.service';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  validateAllowedEmail,
  validateSsoEnforcement,
} from '../../auth/auth.util';
import { FastifyRequest } from 'fastify';

const INVITATION_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class WorkspaceInvitationService {
  private readonly logger = new Logger(WorkspaceInvitationService.name);
  constructor(
    private userRepo: UserRepo,
    private groupUserRepo: GroupUserRepo,
    private mailService: MailService,
    private domainService: DomainService,
    private sessionService: SessionService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.BILLING_QUEUE) private billingQueue: Queue,
    private readonly environmentService: EnvironmentService,
  ) {}

  async getInvitations(workspaceId: string, pagination: PaginationOptions) {
    let query = this.db
      .selectFrom('workspaceInvitations')
      .select(['id', 'email', 'role', 'workspaceId', 'createdAt'])
      .where('workspaceId', '=', workspaceId);

    if (pagination.query) {
      query = query.where((eb) =>
        eb(
          sql`email`,
          'ilike',
          sql`f_unaccent(${'%' + pagination.query + '%'})`,
        ),
      );
    }

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'asc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  async getInvitationById(
    invitationId: string,
    workspace: Workspace,
    token: string,
  ) {
    const invitation = await this.db
      .selectFrom('workspaceInvitations')
      .select(['id', 'email', 'createdAt', 'expiresAt', 'token', 'tokenHash'])
      .where('id', '=', invitationId)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    await this.verifyInvitationToken(invitation, token);

    return {
      id: invitation.id,
      email: invitation.email,
      createdAt: invitation.createdAt,
      enforceSso: workspace.enforceSso,
    };
  }

  async getInvitationTokenById(invitationId: string, workspaceId: string) {
    const invitation = await this.db
      .selectFrom('workspaceInvitations')
      .select(['id'])
      .where('id', '=', invitationId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    return {
      token: await this.rotateInvitationToken(invitationId, workspaceId),
    };
  }

  async createInvitation(
    inviteUserDto: InviteUserDto,
    workspace: Workspace,
    authUser: User,
  ): Promise<void> {
    const { emails, role, groupIds } = inviteUserDto;

    let invites: WorkspaceInvitation[] = [];

    try {
      await executeTx(this.db, async (trx) => {
        // we do not want to invite existing members
        const findExistingUsers = await this.db
          .selectFrom('users')
          .select(['email'])
          .where('users.email', 'in', emails)
          .where('users.workspaceId', '=', workspace.id)
          .execute();

        let existingUserEmails = [];
        if (findExistingUsers) {
          existingUserEmails = findExistingUsers.map((user) => user.email);
        }

        // filter out existing users
        const inviteEmails = emails.filter(
          (email) => !existingUserEmails.includes(email),
        );

        let validGroups = [];
        if (groupIds && groupIds.length > 0) {
          validGroups = await trx
            .selectFrom('groups')
            .select(['id', 'name'])
            .where('groups.id', 'in', groupIds)
            .where('groups.workspaceId', '=', workspace.id)
            .execute();
        }

        const inviteDrafts = inviteEmails.map((email) => {
          const token = this.generateInvitationToken();
          return {
            email,
            token,
            values: {
              email: email,
              role: role,
              token: null,
              tokenHash: this.hashInvitationToken(token),
              expiresAt: this.getInvitationExpiry(),
              workspaceId: workspace.id,
              invitedById: authUser.id,
              groupIds: validGroups?.map((group: Partial<Group>) => group.id),
            },
          };
        });

        if (inviteDrafts.length < 1) {
          return;
        }

        invites = await trx
          .insertInto('workspaceInvitations')
          .values(inviteDrafts.map((draft) => draft.values))
          .onConflict((oc) => oc.columns(['email', 'workspaceId']).doNothing())
          .returningAll()
          .execute();

        const tokenByEmail = new Map(
          inviteDrafts.map((draft) => [draft.email, draft.token]),
        );
        invites = invites.map((invitation) => ({
          ...invitation,
          token: invitation.email
            ? tokenByEmail.get(invitation.email) ?? null
            : null,
        }));
      });
    } catch (err) {
      this.logger.error(`createInvitation - ${err}`);
      throw new BadRequestException(
        'An error occurred while processing the invitations.',
      );
    }

    // do not send code to do nothing users
    if (invites) {
      invites.forEach((invitation: WorkspaceInvitation) => {
        if (!invitation.email || !invitation.token) {
          return;
        }

        this.sendInvitationMail(
          invitation.id,
          invitation.email,
          invitation.token,
          authUser.name,
          workspace.hostname,
        );
      });
    }
  }

  async acceptInvitation(
    dto: AcceptInviteDto,
    workspace: Workspace,
    request?: FastifyRequest,
  ): Promise<{
    authToken?: string;
    requiresLogin?: boolean;
    message?: string;
  }> {
    const invitation = await this.db
      .selectFrom('workspaceInvitations')
      .selectAll()
      .where('id', '=', dto.invitationId)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();

    if (!invitation) {
      throw new BadRequestException('Invitation not found');
    }

    await this.verifyInvitationToken(invitation, dto.token);

    validateSsoEnforcement(workspace);
    validateAllowedEmail(invitation.email, workspace);

    let newUser: User;

    try {
      await executeTx(this.db, async (trx) => {
        newUser = await this.userRepo.insertUser(
          {
            name: dto.name,
            email: invitation.email,
            emailVerifiedAt: new Date(),
            password: dto.password,
            role: invitation.role,
            invitedById: invitation.invitedById,
            workspaceId: workspace.id,
          },
          trx,
        );

        // add user to default group
        await this.groupUserRepo.addUserToDefaultGroup(
          newUser.id,
          workspace.id,
          trx,
        );

        if (invitation.groupIds && invitation.groupIds.length > 0) {
          // Ensure the groups are valid
          const validGroups = await trx
            .selectFrom('groups')
            .select(['id', 'name'])
            .where('groups.id', 'in', invitation.groupIds)
            .where('groups.workspaceId', '=', workspace.id)
            .execute();

          if (validGroups && validGroups.length > 0) {
            const groupUsersToInsert = validGroups.map((group) => ({
              userId: newUser.id,
              groupId: group.id,
            }));

            // add user to groups specified during invite
            await trx
              .insertInto('groupUsers')
              .values(groupUsersToInsert)
              .onConflict((oc) => oc.columns(['userId', 'groupId']).doNothing())
              .execute();
          }
        }

        // delete invitation record
        await trx
          .deleteFrom('workspaceInvitations')
          .where('id', '=', invitation.id)
          .execute();
      });
    } catch (err: any) {
      this.logger.error(`acceptInvitation - ${err}`);
      if (err.message.includes('unique constraint')) {
        throw new BadRequestException('Invitation already accepted');
      }
      throw new BadRequestException(
        'Failed to accept invitation. An error occurred.',
      );
    }

    if (!newUser) {
      return;
    }

    // notify the inviter
    const invitedByUser = await this.userRepo.findById(
      invitation.invitedById,
      workspace.id,
    );

    if (invitedByUser) {
      const emailTemplate = InvitationAcceptedEmail({
        invitedUserName: newUser.name,
        invitedUserEmail: newUser.email,
      });

      await this.mailService.sendToQueue({
        to: invitedByUser.email,
        subject: `${newUser.name} has accepted your Docmost invite`,
        template: emailTemplate,
      });
    }

    if (this.environmentService.isCloud()) {
      await this.billingQueue.add(QueueJob.STRIPE_SEATS_SYNC, {
        workspaceId: workspace.id,
      });
    }

    if (workspace.enforceMfa) {
      return {
        requiresLogin: true,
      };
    }

    const authToken = await this.sessionService.createSessionAndToken(
      newUser,
      request,
    );
    return { authToken };
  }

  async resendInvitation(
    invitationId: string,
    workspace: Workspace,
  ): Promise<void> {
    const invitation = await this.db
      .selectFrom('workspaceInvitations')
      .selectAll()
      .where('id', '=', invitationId)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();

    if (!invitation) {
      throw new BadRequestException('Invitation not found');
    }

    if (!invitation.email) {
      throw new BadRequestException('Invitation is missing an email address');
    }

    const inviteToken = await this.rotateInvitationToken(
      invitation.id,
      workspace.id,
    );

    const invitedByUser = await this.userRepo.findById(
      invitation.invitedById,
      workspace.id,
    );

    if (!invitedByUser) {
      throw new BadRequestException('Invitation inviter not found');
    }

    await this.sendInvitationMail(
      invitation.id,
      invitation.email,
      inviteToken,
      invitedByUser.name,
      workspace.hostname,
    );
  }

  async revokeInvitation(
    invitationId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.db
      .deleteFrom('workspaceInvitations')
      .where('id', '=', invitationId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async getInvitationLinkById(
    invitationId: string,
    workspace: Workspace,
  ): Promise<string> {
    const token = await this.getInvitationTokenById(invitationId, workspace.id);
    return this.buildInviteLink({
      invitationId,
      inviteToken: token.token,
      hostname: workspace.hostname,
    });
  }

  async buildInviteLink(opts: {
    invitationId: string;
    inviteToken: string;
    hostname?: string;
  }): Promise<string> {
    const { invitationId, inviteToken, hostname } = opts;
    return `${this.domainService.getUrl(hostname)}/invites/${invitationId}?token=${inviteToken}`;
  }

  private generateInvitationToken(): string {
    return nanoIdGen(32);
  }

  private getInvitationExpiry(): Date {
    return new Date(Date.now() + INVITATION_TOKEN_TTL_MS);
  }

  private hashInvitationToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private tokenMatches(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);

    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private async verifyInvitationToken(
    invitation: Pick<
      WorkspaceInvitation,
      'id' | 'expiresAt' | 'token' | 'tokenHash'
    >,
    rawToken: string,
  ): Promise<void> {
    const token = rawToken?.trim();
    if (!token) {
      throw new BadRequestException('Invalid invitation token');
    }

    if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
      throw new BadRequestException('Invitation expired');
    }

    const tokenHash = this.hashInvitationToken(token);
    if (
      invitation.tokenHash &&
      this.tokenMatches(tokenHash, invitation.tokenHash)
    ) {
      return;
    }

    if (invitation.token && this.tokenMatches(token, invitation.token)) {
      await this.migrateLegacyInvitationToken(invitation.id, token);
      return;
    }

    throw new BadRequestException('Invalid invitation token');
  }

  private async migrateLegacyInvitationToken(invitationId: string, token: string) {
    await this.db
      .updateTable('workspaceInvitations')
      .set({
        token: null,
        tokenHash: this.hashInvitationToken(token),
        expiresAt: this.getInvitationExpiry(),
        updatedAt: new Date(),
      })
      .where('id', '=', invitationId)
      .where('tokenHash', 'is', null)
      .execute();
  }

  private async rotateInvitationToken(
    invitationId: string,
    workspaceId: string,
  ): Promise<string> {
    const token = this.generateInvitationToken();

    await this.db
      .updateTable('workspaceInvitations')
      .set({
        token: null,
        tokenHash: this.hashInvitationToken(token),
        expiresAt: this.getInvitationExpiry(),
        updatedAt: new Date(),
      })
      .where('id', '=', invitationId)
      .where('workspaceId', '=', workspaceId)
      .execute();

    return token;
  }

  async sendInvitationMail(
    invitationId: string,
    inviteeEmail: string,
    inviteToken: string,
    invitedByName: string,
    hostname?: string,
  ): Promise<void> {
    const inviteLink = await this.buildInviteLink({
      invitationId,
      inviteToken,
      hostname,
    });

    const emailTemplate = InvitationEmail({
      inviteLink,
    });

    await this.mailService.sendToQueue({
      to: inviteeEmail,
      subject: `${invitedByName} invited you to Docmost`,
      template: emailTemplate,
    });
  }
}
