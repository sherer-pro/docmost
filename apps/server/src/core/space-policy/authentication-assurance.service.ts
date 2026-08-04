import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type {
  AuthenticationAssurance,
  AuthenticationAssuranceRequiredError,
  AuthenticationRequirement,
} from '@docmost/api-contract';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import type { UserSession, Workspace } from '@docmost/db/types/entity.types';
import type { AuthPolicyScopeMetadata } from '../../common/decorators/auth-policy-scope.decorator';
import { SpacePolicyService } from './space-policy.service';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { validate as isValidUuid } from 'uuid';
import { sql } from 'kysely';

@Injectable()
export class AuthenticationAssuranceService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spacePolicy: SpacePolicyService,
    private readonly userSessionRepo: UserSessionRepo,
  ) {}

  getAuthenticationAssurance(
    workspace: Workspace,
    session?: UserSession | null,
  ): AuthenticationAssurance {
    const workspaceValues = this.spacePolicy.getWorkspaceValues(workspace);
    const evaluation = this.spacePolicy.evaluateAuthentication(
      workspaceValues,
      session ?? { ssoVerifiedAt: null, mfaVerifiedAt: null },
    );

    return {
      ssoVerified: Boolean(session?.ssoVerifiedAt),
      mfaVerified: Boolean(session?.mfaVerifiedAt),
      workspaceRequirements: evaluation.requirements,
      workspaceMissingRequirements: evaluation.missingRequirements,
    };
  }

  async assertRequestScope(
    metadata: AuthPolicyScopeMetadata | undefined,
    request: any,
  ): Promise<void> {
    if (request.user?.authType === 'api_key') {
      return;
    }

    const workspace = request.user?.workspace as Workspace | undefined;
    const session = request.user?.session as UserSession | undefined;
    if (!workspace || !session) {
      return;
    }

    const scope = metadata?.scope ?? 'workspace';
    if (scope === 'bootstrap') {
      return;
    }

    if (scope === 'workspace') {
      this.assertWorkspace(workspace, session);
      return;
    }

    let targetScope = scope;
    let identifier = this.readIdentifier(metadata, request);
    if (!identifier && metadata?.fallbackKey && metadata.fallbackScope) {
      identifier = request?.[metadata.source ?? 'params']?.[
        metadata.fallbackKey
      ];
      targetScope = metadata.fallbackScope;
    }
    if (!identifier && metadata?.optional) {
      this.assertWorkspace(workspace, session);
      return;
    }
    const spaceId =
      targetScope === 'space'
        ? await this.spacePolicy.resolveSpaceId(workspace.id, identifier)
        : targetScope === 'page'
          ? await this.resolvePageSpaceId(workspace.id, identifier)
          : await this.resolveResourceSpaceId(
              workspace.id,
              metadata?.resourceType,
              identifier,
            );

    if (!spaceId) {
      throw new NotFoundException(
        scope === 'space' ? 'Space not found' : 'Resource not found',
      );
    }

    const policy = await this.spacePolicy.resolve(workspace.id, spaceId);
    if (!policy) {
      throw new NotFoundException('Space not found');
    }

    const evaluation = this.spacePolicy.evaluateAuthentication(
      policy.effective,
      session,
    );
    this.throwIfMissing('space', spaceId, evaluation.missingRequirements);

    for (const target of metadata?.additionalTargets ?? []) {
      const targetIdentifier = request?.[target.source ?? 'params']?.[
        target.key
      ];
      if (!targetIdentifier && target.optional) {
        continue;
      }
      const targetSpaceId =
        target.scope === 'space'
          ? await this.spacePolicy.resolveSpaceId(
              workspace.id,
              targetIdentifier,
            )
          : await this.resolvePageSpaceId(
              workspace.id,
              targetIdentifier,
            );
      if (!targetSpaceId) {
        throw new NotFoundException('Resource not found');
      }
      const targetPolicy = await this.spacePolicy.resolve(
        workspace.id,
        targetSpaceId,
      );
      if (!targetPolicy) {
        throw new NotFoundException('Space not found');
      }
      const targetEvaluation = this.spacePolicy.evaluateAuthentication(
        targetPolicy.effective,
        session,
      );
      this.throwIfMissing(
        'space',
        targetSpaceId,
        targetEvaluation.missingRequirements,
      );
    }
  }

  async markSsoVerified(
    sessionId: string,
    authProviderId: string,
  ): Promise<void> {
    await this.userSessionRepo.updateAssurance(sessionId, {
      ssoVerifiedAt: new Date(),
      ssoAuthProviderId: authProviderId,
    });
  }

  async markMfaVerified(sessionId: string): Promise<void> {
    await this.userSessionRepo.updateAssurance(sessionId, {
      mfaVerifiedAt: new Date(),
    });
  }

  async clearMfaForUser(userId: string, workspaceId: string): Promise<void> {
    await this.userSessionRepo.clearMfaAssuranceForUser(userId, workspaceId);
  }

  private assertWorkspace(workspace: Workspace, session: UserSession): void {
    const values = this.spacePolicy.getWorkspaceValues(workspace);
    const evaluation = this.spacePolicy.evaluateAuthentication(values, session);
    this.throwIfMissing(
      'workspace',
      null,
      evaluation.missingRequirements,
    );
  }

  private readIdentifier(
    metadata: AuthPolicyScopeMetadata,
    request: any,
  ): string | undefined {
    const source = metadata.source ?? 'params';
    const key =
      metadata.key ?? (metadata.scope === 'space' ? 'spaceId' : 'pageId');
    return request?.[source]?.[key];
  }

  private async resolvePageSpaceId(
    workspaceId: string,
    identifier?: string,
  ): Promise<string | null> {
    if (!identifier) {
      return null;
    }

    let query = this.db
      .selectFrom('pages')
      .select('spaceId')
      .where('workspaceId', '=', workspaceId);
    query = isValidUuid(identifier)
      ? query.where('id', '=', identifier)
      : query.where('slugId', '=', identifier);
    const page = await query.executeTakeFirst();
    return page?.spaceId ?? null;
  }

  private async resolveResourceSpaceId(
    workspaceId: string,
    resourceType: AuthPolicyScopeMetadata['resourceType'],
    identifier?: string,
  ): Promise<string | null> {
    if (!identifier || !resourceType) {
      return null;
    }

    if (resourceType === 'attachment') {
      const attachment = await this.db
        .selectFrom('attachments')
        .select('spaceId')
        .where('workspaceId', '=', workspaceId)
        .where('id', '=', identifier)
        .executeTakeFirst();
      return attachment?.spaceId ?? null;
    }

    if (resourceType === 'comment') {
      const comment = await this.db
        .selectFrom('comments')
        .select('spaceId')
        .where('workspaceId', '=', workspaceId)
        .where('id', '=', identifier)
        .executeTakeFirst();
      return comment?.spaceId ?? null;
    }

    if (resourceType === 'database') {
      const database = await this.db
        .selectFrom('databases')
        .select('spaceId')
        .where('workspaceId', '=', workspaceId)
        .where('id', '=', identifier)
        .executeTakeFirst();
      return database?.spaceId ?? null;
    }

    if (resourceType === 'pageHistory') {
      const history = await this.db
        .selectFrom('pageHistory')
        .select('spaceId')
        .where('workspaceId', '=', workspaceId)
        .where('id', '=', identifier)
        .executeTakeFirst();
      return history?.spaceId ?? null;
    }

    if (resourceType === 'fileTask') {
      const task = await this.db
        .selectFrom('fileTasks')
        .select('spaceId')
        .where('workspaceId', '=', workspaceId)
        .where('id', '=', identifier)
        .executeTakeFirst();
      return task?.spaceId ?? null;
    }

    if (resourceType === 'share') {
      const share = await this.db
        .selectFrom('shares')
        .select('spaceId')
        .where('workspaceId', '=', workspaceId)
        .where((eb) =>
          isValidUuid(identifier)
            ? eb('id', '=', identifier)
            : eb(sql`LOWER(key)`, '=', identifier.toLowerCase()),
        )
        .executeTakeFirst();
      return share?.spaceId ?? null;
    }

    const term = await this.db
      .selectFrom('dictionaryTerms')
      .select('spaceId')
      .where('workspaceId', '=', workspaceId)
      .where('id', '=', identifier)
      .executeTakeFirst();
    return term?.spaceId ?? null;
  }

  private throwIfMissing(
    scope: 'workspace' | 'space',
    spaceId: string | null,
    requirements: AuthenticationRequirement[],
  ): void {
    if (requirements.length === 0) {
      return;
    }

    const response: AuthenticationAssuranceRequiredError = {
      statusCode: HttpStatus.PRECONDITION_REQUIRED,
      code: 'AUTHENTICATION_ASSURANCE_REQUIRED',
      message: 'Additional authentication is required',
      scope,
      spaceId,
      requirements,
    };
    throw new HttpException(response, HttpStatus.PRECONDITION_REQUIRED);
  }
}
