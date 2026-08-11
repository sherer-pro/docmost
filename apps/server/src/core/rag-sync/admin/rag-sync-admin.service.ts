import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  RagSyncSpaceConfig,
  RagSyncStatus,
  RagSyncTargetTestResult,
} from '@docmost/api-contract';
import {
  RagSyncBinding,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import { KyselyTransaction } from '@docmost/db/types/kysely.types';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import { encryptProtectedValue } from '../../../common/security/credential-protection.util';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  RagSyncActionDto,
  RagSyncDestructiveActionDto,
  UpdateRagSyncSpaceConfigDto,
} from './rag-sync-admin.dto';
import { RagSyncAdminRepo } from './rag-sync-admin.repo';
import {
  RAG_SYNC_CONTROL,
  RAG_SYNC_OPERATION_LOCK,
  RAG_SYNC_STATUS_READER,
  RAG_SYNC_WRITER,
  RagSyncControl,
  RagSyncOperationLock,
  RagSyncOperationLockError,
  RagSyncStatusReader,
  RagSyncWriter,
  RagSyncWriterTarget,
} from './rag-sync-admin.ports';

const DEFAULT_STATUS: RagSyncStatus = {
  health: 'idle',
  lastAttemptAt: null,
  lastSuccessAt: null,
  lagMs: null,
  errorCode: null,
};

@Injectable()
export class RagSyncAdminService {
  constructor(
    private readonly repo: RagSyncAdminRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly environment: EnvironmentService,
    private readonly config: ConfigService,
    @Inject(RAG_SYNC_OPERATION_LOCK)
    private readonly operationLock: RagSyncOperationLock,
    @Optional()
    @Inject(RAG_SYNC_WRITER)
    private readonly writer?: RagSyncWriter,
    @Optional()
    @Inject(RAG_SYNC_STATUS_READER)
    private readonly statusReader?: RagSyncStatusReader,
    @Optional()
    @Inject(RAG_SYNC_CONTROL)
    private readonly control?: RagSyncControl,
  ) {}

  async getConfig(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<RagSyncSpaceConfig> {
    await this.assertCanManage(spaceId, user, workspace);
    const binding = await this.repo.findBySpace(workspace.id, spaceId);
    return this.toPublicConfig(binding);
  }

  async updateConfig(
    spaceId: string,
    dto: UpdateRagSyncSpaceConfigDto,
    user: User,
    workspace: Workspace,
  ): Promise<RagSyncSpaceConfig> {
    await this.assertCanManage(spaceId, user, workspace);
    if (dto.target?.writerApiKey && dto.target.clearWriterApiKey) {
      throw new BadRequestException(
        'target.writerApiKey and clearWriterApiKey cannot be used together',
      );
    }

    let saved: RagSyncBinding;
    try {
      saved = await this.withOperationLock(workspace.id, spaceId, async () =>
        this.repo.withSpaceLock(workspace.id, spaceId, async (trx) => {
          let existing = await this.repo.findBySpace(
            workspace.id,
            spaceId,
            trx,
          );
          this.assertExpectedVersion(existing, dto.expectedVersion);

          const normalized = this.resolveTarget(existing, dto);
          const targetChanged = this.targetChanged(existing, normalized);
          if (
            targetChanged &&
            existing &&
            (existing.state !== 'disabled' || existing.cleanupRequired)
          ) {
            throw new ConflictException({
              code: existing.cleanupRequired
                ? 'rag_sync_cleanup_required'
                : 'rag_sync_invalid_state',
              message:
                'Disable RAG sync and complete cleanup before changing the target',
            });
          }
          if (
            dto.target?.clearWriterApiKey &&
            existing &&
            (existing.state !== 'disabled' || existing.cleanupRequired)
          ) {
            throw new ConflictException({
              code: 'rag_sync_invalid_state',
              message:
                'Writer API key can only be cleared from a clean disabled binding',
            });
          }

          const encryptedKey = this.resolveEncryptedKey(
            existing,
            dto,
            targetChanged,
          );
          const writerKeyChanged =
            dto.target?.writerApiKey !== undefined ||
            dto.target?.clearWriterApiKey === true;
          if (!existing) {
            existing = await this.repo.insertBinding(
              workspace.id,
              spaceId,
              user.id,
              trx,
              {
                adapter: normalized.adapter,
                baseUrl: normalized.baseUrl,
                knowledgeId: normalized.knowledgeId,
                writerApiKeyEncrypted: encryptedKey,
              },
            );
          }

          let targetClaimId = existing.targetClaimId;
          let resumedCleanup = false;
          if (
            (targetChanged || dto.target?.clearWriterApiKey) &&
            targetClaimId
          ) {
            await this.repo.updateBinding(
              existing.id,
              { targetClaimId: null },
              trx,
            );
            if (!(await this.repo.deleteClaim(targetClaimId, existing, trx))) {
              throw this.targetInUse();
            }
            targetClaimId = null;
          }
          if (normalized.baseUrl && normalized.knowledgeId && encryptedKey) {
            const claim = await this.ensureTargetClaim(
              workspace.id,
              spaceId,
              existing.id,
              normalized.baseUrl,
              normalized.knowledgeId,
              targetClaimId,
              trx,
            );
            targetClaimId = claim.id;
            resumedCleanup = claim.resumedCleanup;
          }

          return this.repo.updateBinding(
            existing.id,
            {
              adapter: normalized.adapter,
              baseUrl: normalized.baseUrl,
              knowledgeId: normalized.knowledgeId,
              writerApiKeyEncrypted: encryptedKey,
              targetClaimId,
              cleanupRequired: existing.cleanupRequired || resumedCleanup,
              lastTestedAt:
                targetChanged || writerKeyChanged
                  ? null
                  : existing.lastTestedAt,
              targetVersion: existing.targetVersion + (targetChanged ? 1 : 0),
              configVersion:
                existing.configVersion + (dto.expectedVersion ? 1 : 0),
              updatedById: user.id,
            },
            trx,
          );
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.targetInUse();
      }
      throw error;
    }

    await this.notify(saved.id);
    return this.toPublicConfig(saved);
  }

  async testTarget(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<RagSyncTargetTestResult> {
    await this.assertCanManage(spaceId, user, workspace);
    this.assertDeploymentEnabled();
    if (!this.writer) {
      throw new ServiceUnavailableException({
        code: 'rag_sync_writer_unavailable',
        message: 'RAG sync writer is unavailable',
      });
    }
    return this.withOperationLock(
      workspace.id,
      spaceId,
      async (signal) => {
        const armed = await this.repo.withSpaceLock(
          workspace.id,
          spaceId,
          async (trx) => {
            const current = await this.repo.findBySpace(
              workspace.id,
              spaceId,
              trx,
            );
            if (!current) {
              throw new NotFoundException('RAG sync binding not found');
            }
            if (current.state !== 'disabled' || current.cleanupRequired) {
              throw new ConflictException({
                code: current.cleanupRequired
                  ? 'rag_sync_cleanup_in_progress'
                  : 'rag_sync_invalid_state',
                message:
                  'Target testing requires a clean disabled RAG sync binding',
              });
            }
            this.assertConfigured(current);
            const targetClaim = await this.ensureTargetClaim(
              workspace.id,
              spaceId,
              current.id,
              current.baseUrl,
              current.knowledgeId,
              current.targetClaimId,
              trx,
            );
            if (targetClaim.resumedCleanup) {
              throw new ConflictException({
                code: 'rag_sync_cleanup_required',
                message: 'Complete cleanup before testing this target',
              });
            }
            return this.repo.updateBinding(
              current.id,
              {
                targetClaimId: targetClaim.id,
                cleanupRequired: true,
                lastTestedAt: null,
                configVersion: current.configVersion + 1,
                updatedById: user.id,
              },
              trx,
            );
          },
        );
        await this.notify(armed.id);
        const target = this.toWriterTarget(armed);
        let result: RagSyncTargetTestResult;
        try {
          result = await this.writer!.testTarget(target, signal);
        } catch (error) {
          if (error instanceof RagSyncOperationLockError) throw error;
          const code = this.safeWriterErrorCode(error);
          throw new ServiceUnavailableException({
            code,
            message: 'Open WebUI target test failed',
          });
        }

        const completed = await this.repo.withSpaceLock(
          workspace.id,
          spaceId,
          (trx) =>
            this.repo.completeTargetTest(
              armed.id,
              armed.configVersion,
              armed.targetVersion,
              trx,
            ),
        );
        if (!completed) {
          throw new ConflictException({
            code: 'rag_sync_config_conflict',
            message:
              'Target test completed, but cleanup state changed; run cleanup before continuing',
          });
        }
        await this.notify(completed.id);
        return result;
      },
      { reserveGlobalSlot: true },
    );
  }

  enable(
    spaceId: string,
    dto: RagSyncActionDto,
    user: User,
    workspace: Workspace,
  ): Promise<RagSyncSpaceConfig> {
    return this.transition(
      spaceId,
      dto,
      user,
      workspace,
      async (current, trx) => {
        this.assertDeploymentEnabled();
        if (current.cleanupRequired) {
          throw new ConflictException({
            code: 'rag_sync_cleanup_required',
            message: 'Complete or abandon cleanup before enabling RAG sync',
          });
        }
        this.assertConfigured(current);
        if (!current.lastTestedAt) {
          throw new ConflictException({
            code: 'rag_sync_target_not_tested',
            message:
              'Test the current Open WebUI target before enabling RAG sync',
          });
        }
        const targetClaim = await this.ensureTargetClaim(
          workspace.id,
          spaceId,
          current.id,
          current.baseUrl,
          current.knowledgeId,
          current.targetClaimId,
          trx,
        );
        if (targetClaim.resumedCleanup) {
          throw new ConflictException({
            code: 'rag_sync_cleanup_required',
            message: 'Resume and complete cleanup before enabling RAG sync',
          });
        }
        return this.repo.updateBinding(
          current.id,
          {
            state: 'enabled',
            targetClaimId: targetClaim.id,
            configVersion: current.configVersion + 1,
            updatedById: user.id,
          },
          trx,
        );
      },
    );
  }

  disable(
    spaceId: string,
    dto: RagSyncActionDto,
    user: User,
    workspace: Workspace,
  ): Promise<RagSyncSpaceConfig> {
    return this.transition(
      spaceId,
      dto,
      user,
      workspace,
      async (current, trx) => {
        if (current.state === 'disabled' && !current.cleanupRequired) {
          return current;
        }
        if (current.state === 'disabled') {
          throw new ConflictException({
            code: 'rag_sync_cleanup_required',
            message: 'Use retry-cleanup to resume an interrupted cleanup',
          });
        }
        if (current.state === 'draining') return current;
        return this.repo.updateBinding(
          current.id,
          {
            state: 'draining',
            cleanupRequired: true,
            configVersion: current.configVersion + 1,
            updatedById: user.id,
          },
          trx,
        );
      },
    );
  }

  retryCleanup(
    spaceId: string,
    dto: RagSyncActionDto,
    user: User,
    workspace: Workspace,
  ): Promise<RagSyncSpaceConfig> {
    return this.transition(
      spaceId,
      dto,
      user,
      workspace,
      async (current, trx) => {
        this.assertDeploymentEnabled();
        if (!current.cleanupRequired) {
          throw new ConflictException({
            code: 'rag_sync_invalid_state',
            message: 'This binding does not require cleanup',
          });
        }
        this.assertConfigured(current);
        return this.repo.updateBinding(
          current.id,
          {
            state: 'draining',
            configVersion: current.configVersion + 1,
            updatedById: user.id,
          },
          trx,
        );
      },
    );
  }

  forceDisable(
    spaceId: string,
    dto: RagSyncDestructiveActionDto,
    user: User,
    workspace: Workspace,
  ): Promise<RagSyncSpaceConfig> {
    this.assertConfirmed(dto);
    return this.transition(spaceId, dto, user, workspace, (current, trx) => {
      if (current.state === 'disabled') {
        if (current.cleanupRequired) return Promise.resolve(current);
        throw new ConflictException({
          code: 'rag_sync_invalid_state',
          message: 'A clean disabled binding cannot be force-disabled',
        });
      }
      return this.repo.updateBinding(
        current.id,
        {
          state: 'disabled',
          cleanupRequired: true,
          configVersion: current.configVersion + 1,
          updatedById: user.id,
        },
        trx,
      );
    });
  }

  abandonCleanup(
    spaceId: string,
    dto: RagSyncDestructiveActionDto,
    user: User,
    workspace: Workspace,
  ): Promise<RagSyncSpaceConfig> {
    this.assertConfirmed(dto);
    return this.transition(
      spaceId,
      dto,
      user,
      workspace,
      async (current, trx) => {
        if (current.state !== 'disabled' || !current.cleanupRequired) {
          throw new ConflictException({
            code: 'rag_sync_invalid_state',
            message: 'Force-disable the binding before abandoning cleanup',
          });
        }
        if (current.targetClaimId) {
          await this.repo.orphanClaim(current.targetClaimId, trx);
        }
        return this.repo.updateBinding(
          current.id,
          {
            baseUrl: null,
            knowledgeId: null,
            writerApiKeyEncrypted: null,
            targetClaimId: null,
            cleanupRequired: false,
            targetVersion: current.targetVersion + 1,
            configVersion: current.configVersion + 1,
            updatedById: user.id,
          },
          trx,
        );
      },
    );
  }

  private async transition(
    spaceId: string,
    dto: RagSyncActionDto,
    user: User,
    workspace: Workspace,
    mutate: (
      binding: RagSyncBinding,
      trx: KyselyTransaction,
    ) => Promise<RagSyncBinding>,
  ): Promise<RagSyncSpaceConfig> {
    await this.assertCanManage(spaceId, user, workspace);
    let saved: RagSyncBinding;
    try {
      saved = await this.withOperationLock(workspace.id, spaceId, async () =>
        this.repo.withSpaceLock(workspace.id, spaceId, async (trx) => {
          const current = await this.repo.findBySpace(
            workspace.id,
            spaceId,
            trx,
          );
          if (!current) {
            throw new NotFoundException('RAG sync binding not found');
          }
          this.assertExpectedVersion(current, dto.expectedVersion);
          return mutate(current, trx);
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) throw this.targetInUse();
      throw error;
    }
    await this.notify(saved.id);
    return this.toPublicConfig(saved);
  }

  private async assertCanManage(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<void> {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    if (user.workspaceId !== workspace.id) {
      throw new NotFoundException('Space not found');
    }
    if (!(await this.repo.spaceExists(workspace.id, spaceId))) {
      throw new NotFoundException('Space not found');
    }
  }

  private async withOperationLock<T>(
    workspaceId: string,
    spaceId: string,
    callback: (signal: AbortSignal) => Promise<T>,
    options?: { reserveGlobalSlot?: boolean },
  ): Promise<T> {
    try {
      return await this.operationLock.runExclusive(
        workspaceId,
        spaceId,
        callback,
        options,
      );
    } catch (error) {
      if (!(error instanceof RagSyncOperationLockError)) throw error;
      if (error.reason === 'busy') {
        throw new ConflictException({
          code: 'rag_sync_config_conflict',
          message: 'Another RAG sync configuration operation is in progress',
        });
      }
      throw new ServiceUnavailableException({
        code:
          error.reason === 'lost'
            ? 'rag_sync_lease_lost'
            : 'rag_sync_writer_unavailable',
        message: 'RAG sync operation coordination is unavailable',
      });
    }
  }

  private assertExpectedVersion(
    binding: RagSyncBinding | undefined,
    expectedVersion: number | null,
  ): void {
    if (
      (!binding && expectedVersion !== null) ||
      (binding && binding.configVersion !== expectedVersion)
    ) {
      throw new ConflictException({
        code: 'rag_sync_config_conflict',
        message: 'RAG sync configuration changed; reload and try again',
      });
    }
  }

  private resolveTarget(
    existing: RagSyncBinding | undefined,
    dto: UpdateRagSyncSpaceConfigDto,
  ) {
    const adapter = dto.target?.adapter ?? 'open-webui-knowledge-v1';
    const baseUrl =
      dto.target?.baseUrl === undefined
        ? (existing?.baseUrl ?? null)
        : dto.target.baseUrl === null
          ? null
          : this.normalizeBaseUrl(dto.target.baseUrl);
    const knowledgeId =
      dto.target?.knowledgeId === undefined
        ? (existing?.knowledgeId ?? null)
        : dto.target.knowledgeId?.trim() || null;
    return { adapter, baseUrl, knowledgeId };
  }

  private normalizeBaseUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new BadRequestException('target.baseUrl must be a valid URL');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new BadRequestException(
        'target.baseUrl must be an HTTP(S) origin without credentials, path, query, or fragment',
      );
    }
    if (url.hostname.endsWith('.')) {
      url.hostname = url.hostname.slice(0, -1);
    }
    return url.toString().replace(/\/+$/, '');
  }

  private targetChanged(
    existing: RagSyncBinding | undefined,
    target: {
      adapter: string;
      baseUrl: string | null;
      knowledgeId: string | null;
    },
  ): boolean {
    return Boolean(
      existing &&
        (existing.adapter !== target.adapter ||
          existing.baseUrl !== target.baseUrl ||
          existing.knowledgeId !== target.knowledgeId),
    );
  }

  private resolveEncryptedKey(
    existing: RagSyncBinding | undefined,
    dto: UpdateRagSyncSpaceConfigDto,
    targetChanged: boolean,
  ): string | null {
    if (dto.target?.clearWriterApiKey) return null;
    if (dto.target?.writerApiKey !== undefined) {
      const key = dto.target.writerApiKey.trim();
      if (!key) throw new BadRequestException('Writer API key cannot be empty');
      return encryptProtectedValue(key, this.environment.getAppSecret());
    }
    return targetChanged ? null : (existing?.writerApiKeyEncrypted ?? null);
  }

  private async ensureTargetClaim(
    workspaceId: string,
    spaceId: string,
    bindingId: string,
    baseUrl: string,
    knowledgeId: string,
    currentClaimId: string | null,
    trx: KyselyTransaction,
  ): Promise<{ id: string; resumedCleanup: boolean }> {
    if (currentClaimId) {
      const current = await this.repo.findClaimById(currentClaimId, trx);
      const fingerprint = this.targetFingerprint(baseUrl, knowledgeId);
      if (
        !current ||
        current.workspaceId !== workspaceId ||
        current.spaceId !== spaceId ||
        current.bindingId !== bindingId ||
        current.targetFingerprint !== fingerprint
      ) {
        throw this.targetInUse();
      }
      if (current.state === 'orphaned') {
        await this.repo.activateClaim(current.id, trx);
        return { id: current.id, resumedCleanup: true };
      }
      if (current.state !== 'active') throw this.targetInUse();
      return { id: current.id, resumedCleanup: false };
    }
    const fingerprint = this.targetFingerprint(baseUrl, knowledgeId);
    const claim = await this.repo.findClaimByFingerprint(fingerprint, trx);
    if (claim) {
      if (
        claim.workspaceId !== workspaceId ||
        claim.spaceId !== spaceId ||
        claim.bindingId !== bindingId
      ) {
        throw this.targetInUse();
      }
      await this.repo.activateClaim(claim.id, trx);
      return { id: claim.id, resumedCleanup: claim.state === 'orphaned' };
    }
    const inserted = await this.repo.insertClaim(
      workspaceId,
      spaceId,
      bindingId,
      fingerprint,
      trx,
    );
    return { id: inserted.id, resumedCleanup: false };
  }

  private targetFingerprint(baseUrl: string, knowledgeId: string): string {
    const target = new URL(baseUrl);
    if (target.hostname.endsWith('.')) {
      target.hostname = target.hostname.slice(0, -1);
    }
    const origin = target.origin.toLowerCase();
    return createHash('sha256')
      .update(`${origin}\n${knowledgeId}`, 'utf8')
      .digest('hex');
  }

  private toWriterTarget(binding?: RagSyncBinding): RagSyncWriterTarget {
    this.assertConfigured(binding);
    return {
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      spaceId: binding.spaceId,
      adapter: 'open-webui-knowledge-v1',
      baseUrl: binding.baseUrl,
      knowledgeId: binding.knowledgeId,
      configVersion: binding.configVersion,
      targetVersion: binding.targetVersion,
    };
  }

  private assertConfigured(
    binding?: RagSyncBinding,
  ): asserts binding is RagSyncBinding & {
    baseUrl: string;
    knowledgeId: string;
    writerApiKeyEncrypted: string;
  } {
    if (
      !binding?.baseUrl ||
      !binding.knowledgeId ||
      !binding.writerApiKeyEncrypted
    ) {
      throw new BadRequestException({
        code: 'rag_sync_not_configured',
        message: 'Open WebUI target and writer API key are required',
      });
    }
  }

  private assertDeploymentEnabled(): void {
    if (!this.isDeploymentEnabled()) {
      throw new ServiceUnavailableException({
        code: 'rag_sync_deployment_disabled',
        message: 'RAG sync is disabled for this deployment',
      });
    }
  }

  private isDeploymentEnabled(): boolean {
    return (
      this.config
        .get<string>('RAG_SYNC_ENABLED', 'false')
        .trim()
        .toLowerCase() === 'true'
    );
  }

  private assertConfirmed(dto: RagSyncDestructiveActionDto): void {
    if (dto.confirm !== true) {
      throw new BadRequestException('Explicit confirmation is required');
    }
  }

  private async toPublicConfig(
    binding?: RagSyncBinding,
  ): Promise<RagSyncSpaceConfig> {
    const deploymentEnabled = this.isDeploymentEnabled();
    let status: RagSyncStatus = binding
      ? { ...DEFAULT_STATUS }
      : { ...DEFAULT_STATUS, health: 'disabled' };
    if (binding?.state === 'disabled') status.health = 'disabled';
    if (binding && this.statusReader) {
      try {
        const operational = await this.statusReader.getStatus(binding.id);
        if (operational) {
          status = {
            health: operational.health,
            lastAttemptAt: operational.lastAttemptAt,
            lastSuccessAt: operational.lastSuccessAt,
            lagMs: operational.lagMs,
            errorCode: operational.errorCode,
          };
        }
      } catch {
        status = { ...status, health: 'degraded' };
      }
    }
    if (binding?.state === 'disabled') status.health = 'disabled';
    if (!deploymentEnabled) status.health = 'disabled';
    return {
      deploymentEnabled,
      bindingId: binding?.id ?? null,
      state: (binding?.state as RagSyncSpaceConfig['state']) ?? 'disabled',
      configVersion: binding?.configVersion ?? null,
      target: {
        adapter: 'open-webui-knowledge-v1',
        baseUrl: binding?.baseUrl ?? null,
        knowledgeId: binding?.knowledgeId ?? null,
        writerApiKeyConfigured: Boolean(binding?.writerApiKeyEncrypted),
        lastTestedAt: binding?.lastTestedAt?.toISOString() ?? null,
      },
      cleanupRequired: binding?.cleanupRequired ?? false,
      status,
    };
  }

  private async notify(bindingId: string): Promise<void> {
    try {
      await this.control?.bindingChanged(bindingId);
    } catch {
      // Discovery polling is authoritative; notification only reduces latency.
    }
  }

  private targetInUse(): ConflictException {
    return new ConflictException({
      code: 'rag_sync_target_in_use',
      message: 'This Open WebUI Knowledge Base is already claimed',
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === '23505',
    );
  }

  private safeWriterErrorCode(error: unknown) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code === 'rag_sync_writer_unauthorized'
      ? code
      : 'rag_sync_target_unavailable';
  }
}
