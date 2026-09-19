import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateSpaceDto } from '../dto/create-space.dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { Space, User } from '@docmost/db/types/entity.types';
import { UpdateSpaceDto } from '../dto/update-space.dto';
import { executeTx } from '@docmost/db/utils';
import { InjectKysely } from 'nestjs-kysely';
import { SpaceMemberService } from './space-member.service';
import { SpaceRole } from '../../../common/helpers/types/permission';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { CursorPaginationResult } from '@docmost/db/pagination/cursor-pagination';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { SpacePolicyService } from '../../space-policy/space-policy.service';
import { isEnforcementReadyProvider } from '../../sso/sso-provider.util';
import { SsoEndpointPolicyService } from '../../../integrations/environment/sso-endpoint-policy.service';
import type {
  AuthProvider,
  SpaceSettings,
} from '@docmost/db/types/entity.types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';
import { QueueOutboxService } from '../../../integrations/queue/outbox/queue-outbox.service';

@Injectable()
export class SpaceService {
  constructor(
    private spaceRepo: SpaceRepo,
    private spaceMemberService: SpaceMemberService,
    private shareRepo: ShareRepo,
    private workspaceRepo: WorkspaceRepo,
    private readonly spacePolicy: SpacePolicyService,
    private readonly ssoEndpointPolicy: SsoEndpointPolicyService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private readonly queueOutboxService?: QueueOutboxService,
  ) {}

  async createSpace(
    authUser: User,
    workspaceId: string,
    createSpaceDto: CreateSpaceDto,
    trx?: KyselyTransaction,
  ): Promise<Space> {
    let space = null;

    await executeTx(
      this.db,
      async (trx) => {
        space = await this.create(
          authUser.id,
          workspaceId,
          createSpaceDto,
          trx,
        );

        await this.spaceMemberService.addUserToSpace(
          authUser.id,
          space.id,
          SpaceRole.ADMIN,
          workspaceId,
          trx,
        );
      },
      trx,
    );

    return { ...space, memberCount: 1 };
  }

  async create(
    userId: string,
    workspaceId: string,
    createSpaceDto: CreateSpaceDto,
    trx?: KyselyTransaction,
  ): Promise<Space> {
    const slugExists = await this.spaceRepo.slugExists(
      createSpaceDto.slug,
      workspaceId,
      trx,
    );
    if (slugExists) {
      throw new BadRequestException(
        'Space slug exists. Please use a unique space slug',
      );
    }

    return await this.spaceRepo.insertSpace(
      {
        name: createSpaceDto.name ?? 'untitled space',
        description: createSpaceDto.description ?? '',
        creatorId: userId,
        workspaceId: workspaceId,
        slug: createSpaceDto.slug,
      },
      trx,
    );
  }

  async updateSpace(
    updateSpaceDto: UpdateSpaceDto,
    workspaceId: string,
    options: { canLoosenPolicy?: boolean } = {},
  ): Promise<Space> {
    const hasPolicyUpdate = [
      'disablePublicSharing',
      'enforceMfa',
      'enforceSso',
    ].some((key) => typeof updateSpaceDto[key] !== 'undefined');
    if (
      hasPolicyUpdate &&
      !options.canLoosenPolicy &&
      [
        updateSpaceDto.disablePublicSharing,
        updateSpaceDto.enforceMfa,
        updateSpaceDto.enforceSso,
      ].some((value) => value !== undefined && value !== true)
    ) {
      throw new ForbiddenException(
        'Only workspace administrators can disable or reset a space policy override',
      );
    }
    const result = await executeTx(this.db, async (trx) => {
      const workspace = await this.workspaceRepo.findById(workspaceId, {
        withLock: true,
        trx,
      });
      const space = await this.spaceRepo.findById(
        updateSpaceDto.spaceId,
        workspaceId,
        { withLock: true, trx },
      );
      if (!workspace || !space) throw new NotFoundException('Space not found');
      if (
        updateSpaceDto.slug &&
        updateSpaceDto.slug.toLowerCase() !== space.slug.toLowerCase() &&
        (await this.spaceRepo.slugExists(updateSpaceDto.slug, workspaceId, trx))
      ) {
        throw new BadRequestException(
          'Space slug exists. Please use a unique space slug',
        );
      }
      const currentPolicy = this.spacePolicy.resolveFromSettings(
        workspace,
        space.settings,
      );
      const settings = this.applyPolicyUpdates(space.settings, updateSpaceDto);
      const nextPolicy = this.spacePolicy.resolveFromSettings(
        workspace,
        settings,
      );
      if (hasPolicyUpdate && !options.canLoosenPolicy) {
        const requested = [
          updateSpaceDto.disablePublicSharing,
          updateSpaceDto.enforceMfa,
          updateSpaceDto.enforceSso,
        ].filter((value) => typeof value !== 'undefined');
        if (
          requested.some((value) => value !== true) ||
          this.spacePolicy.isLoosening(
            currentPolicy.effective,
            nextPolicy.effective,
          )
        ) {
          throw new ForbiddenException(
            'Only workspace administrators can disable or reset a space policy override',
          );
        }
      }
      if (
        !currentPolicy.effective.enforceSso &&
        nextPolicy.effective.enforceSso
      ) {
        await this.assertSsoEnforcementReady(workspaceId, trx);
      }
      if (updateSpaceDto.documentFields)
        settings.documentFields = {
          ...settings.documentFields,
          ...updateSpaceDto.documentFields,
        };
      if (typeof updateSpaceDto.dictionaryEnabled !== 'undefined')
        settings.dictionary = {
          ...settings.dictionary,
          enabled: updateSpaceDto.dictionaryEnabled,
        };
      if (updateSpaceDto.tagSettings)
        settings.tags = { ...settings.tags, ...updateSpaceDto.tagSettings };
      if (typeof updateSpaceDto.headingNumberingEnabled !== 'undefined')
        settings.headingNumbering = {
          ...settings.headingNumbering,
          enabled: updateSpaceDto.headingNumberingEnabled,
        };
      if (updateSpaceDto.customLinks)
        settings.customLinks = {
          links: (updateSpaceDto.customLinks.links ?? []).map((link) => ({
            id: link.id || randomUUID(),
            label: link.label.trim(),
            url: link.url.trim(),
            icon: link.icon,
          })),
        };
      const updated = await this.spaceRepo.updateSpace(
        {
          name: updateSpaceDto.name,
          description: updateSpaceDto.description,
          slug: updateSpaceDto.slug,
          settings: settings as any,
        },
        updateSpaceDto.spaceId,
        workspaceId,
        trx,
      );
      if (
        !currentPolicy.effective.disablePublicSharing &&
        nextPolicy.effective.disablePublicSharing
      ) {
        await this.shareRepo.deleteBySpaceId(
          updateSpaceDto.spaceId,
          workspaceId,
          trx,
        );
      }
      return this.spacePolicy.withPolicy(updated, workspace) as Space;
    });
    if (hasPolicyUpdate)
      await this.eventEmitter?.emitAsync(EventName.AUTHORIZATION_CHANGED, {
        workspaceId,
        spaceId: updateSpaceDto.spaceId,
      });
    if (
      updateSpaceDto.documentFields ||
      typeof updateSpaceDto.dictionaryEnabled !== 'undefined'
    ) {
      void this.eventEmitter
        ?.emitAsync(EventName.RAG_SYNC_SCOPE_CHANGED, {
          spaceId: updateSpaceDto.spaceId,
        })
        .catch(() => undefined);
    }
    return result;
  }

  async getSpaceInfo(spaceId: string, workspaceId: string): Promise<Space> {
    const space = await this.spaceRepo.findById(spaceId, workspaceId, {
      includeMemberCount: true,
    });
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const workspace = await this.workspaceRepo.findById(workspaceId);
    return workspace
      ? (this.spacePolicy.withPolicy(space, workspace) as Space)
      : space;
  }

  async archiveSpace(spaceId: string, workspaceId: string): Promise<Space> {
    const space = await this.spaceRepo.archiveSpace(spaceId, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    return space;
  }

  async unarchiveSpace(spaceId: string, workspaceId: string): Promise<Space> {
    const space = await this.spaceRepo.unarchiveSpace(spaceId, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    return space;
  }

  async getWorkspaceSpaces(
    workspaceId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Space>> {
    return this.spaceRepo.getSpacesInWorkspace(workspaceId, pagination);
  }

  async deleteSpace(spaceId: string, workspaceId: string): Promise<void> {
    const space = await this.spaceRepo.findById(spaceId, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const blockedByRagSync = await this.db
      .selectFrom('ragSyncBindings')
      .select('id')
      .where('spaceId', '=', spaceId)
      .where((eb) =>
        eb.or([
          eb('state', 'in', ['enabled', 'draining']),
          eb('cleanupRequired', '=', true),
        ]),
      )
      .executeTakeFirst();
    if (blockedByRagSync) {
      throw new ConflictException({
        code: 'rag_sync_cleanup_required',
        message: 'Disable RAG sync and complete or abandon cleanup first',
      });
    }

    if (!this.queueOutboxService) {
      throw new Error('queue_outbox_unavailable');
    }
    const cleanupEnqueued = await executeTx(this.db, async (trx) => {
      const lockedSpace = await this.spaceRepo.findById(spaceId, workspaceId, {
        withLock: true,
        trx,
      });
      if (!lockedSpace) {
        throw new NotFoundException('Space not found');
      }
      if (
        await this.spaceRepo.hasImportCleanupBlockers(spaceId, workspaceId, trx)
      ) {
        throw new ConflictException({
          code: 'space_import_cleanup_required',
          message:
            'Wait for active imports and import artifact cleanup to finish first',
        });
      }
      const enqueued =
        await this.queueOutboxService!.enqueueSpaceAttachmentCleanup(
          spaceId,
          workspaceId,
          trx,
        );
      await this.spaceRepo.deleteSpace(spaceId, workspaceId, trx);
      return enqueued;
    });
    if (cleanupEnqueued) this.queueOutboxService.kick();
  }

  private applyPolicyUpdates(
    rawSettings: unknown,
    dto: Pick<
      UpdateSpaceDto,
      'disablePublicSharing' | 'enforceMfa' | 'enforceSso'
    >,
  ): SpaceSettings {
    const settings = structuredClone((rawSettings ?? {}) as SpaceSettings);
    settings.security = { ...(settings.security ?? {}) };
    settings.sharing = { ...(settings.sharing ?? {}) };

    this.applyOverride(settings.security, 'enforceMfa', dto.enforceMfa);
    this.applyOverride(settings.security, 'enforceSso', dto.enforceSso);
    this.applyOverride(settings.sharing, 'disabled', dto.disablePublicSharing);

    if (Object.keys(settings.security).length === 0) {
      delete settings.security;
    }
    if (Object.keys(settings.sharing).length === 0) {
      delete settings.sharing;
    }

    return settings;
  }

  private applyOverride<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: T[K] | null | undefined,
  ): void {
    if (typeof value === 'undefined') {
      return;
    }
    if (value === null) {
      delete target[key];
      return;
    }
    target[key] = value;
  }

  private async assertSsoEnforcementReady(
    workspaceId: string,
    trx: KyselyTransaction,
  ): Promise<void> {
    const providers = await trx
      .selectFrom('authProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('isEnabled', '=', true)
      .where('deletedAt', 'is', null)
      .execute();

    for (const provider of providers as AuthProvider[]) {
      if (!isEnforcementReadyProvider(provider)) {
        continue;
      }

      const endpoint =
        provider.type === 'oidc'
          ? provider.oidcIssuer
          : provider.type === 'saml'
            ? provider.samlUrl
            : provider.ldapUrl;
      const protocols =
        provider.type === 'ldap'
          ? (['ldap:', 'ldaps:'] as const)
          : (['http:', 'https:'] as const);

      try {
        await this.ssoEndpointPolicy.assertAllowed(
          endpoint,
          protocols,
          'SSO provider',
        );
        return;
      } catch {
        // Continue checking other configured providers.
      }
    }

    throw new BadRequestException(
      'At least one enabled and verified SSO provider is required',
    );
  }
}
