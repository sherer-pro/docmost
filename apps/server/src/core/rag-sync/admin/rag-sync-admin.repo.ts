import { ConflictException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  RagSyncBinding,
  RagSyncTargetClaim,
} from '@docmost/db/types/entity.types';
import { RagSyncBindingState } from '@docmost/api-contract';

type DbOrTx = KyselyDB | KyselyTransaction;

export interface RagSyncBindingValues {
  state?: RagSyncBindingState;
  adapter?: 'open-webui-knowledge-v1';
  baseUrl?: string | null;
  knowledgeId?: string | null;
  writerApiKeyEncrypted?: string | null;
  targetClaimId?: string | null;
  cleanupRequired?: boolean;
  lastTestedAt?: Date | null;
  targetVersion?: number;
  configVersion?: number;
  updatedById?: string | null;
}

@Injectable()
export class RagSyncAdminRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async withSpaceLock<T>(
    workspaceId: string,
    spaceId: string,
    callback: (trx: KyselyTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`rag-sync:${workspaceId}:${spaceId}`}, 0)
        )
      `.execute(trx);
      return callback(trx);
    });
  }

  async spaceExists(
    workspaceId: string,
    spaceId: string,
    trx: DbOrTx = this.db,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    return Boolean(row);
  }

  findBySpace(
    workspaceId: string,
    spaceId: string,
    trx: DbOrTx = this.db,
  ): Promise<RagSyncBinding | undefined> {
    return trx
      .selectFrom('ragSyncBindings')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .executeTakeFirst();
  }

  findById(
    bindingId: string,
    trx: DbOrTx = this.db,
  ): Promise<RagSyncBinding | undefined> {
    return trx
      .selectFrom('ragSyncBindings')
      .selectAll()
      .where('id', '=', bindingId)
      .executeTakeFirst();
  }

  findAiRetrievalTarget(
    workspaceId: string,
    spaceId: string,
    trx: DbOrTx = this.db,
  ) {
    return trx
      .selectFrom('aiSpaceConfigs')
      .select([
        'retrievalAdapter',
        'retrievalOpenWebuiBaseUrl',
        'retrievalOpenWebuiKnowledgeId',
      ])
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .executeTakeFirst();
  }

  async insertBinding(
    workspaceId: string,
    spaceId: string,
    actorId: string,
    trx: KyselyTransaction,
    values: RagSyncBindingValues = {},
  ): Promise<RagSyncBinding> {
    return trx
      .insertInto('ragSyncBindings')
      .values({
        workspaceId,
        spaceId,
        createdById: actorId,
        updatedById: actorId,
        ...values,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateBinding(
    bindingId: string,
    values: RagSyncBindingValues,
    trx: KyselyTransaction,
  ): Promise<RagSyncBinding> {
    return trx
      .updateTable('ragSyncBindings')
      .set({ ...values, updatedAt: sql`clock_timestamp()` })
      .where('id', '=', bindingId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findClaimByFingerprint(
    targetFingerprint: string,
    trx: KyselyTransaction,
  ): Promise<RagSyncTargetClaim | undefined> {
    return trx
      .selectFrom('ragSyncTargetClaims')
      .selectAll()
      .where('targetFingerprint', '=', targetFingerprint)
      .executeTakeFirst();
  }

  findClaimById(
    claimId: string,
    trx: DbOrTx = this.db,
  ): Promise<RagSyncTargetClaim | undefined> {
    return trx
      .selectFrom('ragSyncTargetClaims')
      .selectAll()
      .where('id', '=', claimId)
      .executeTakeFirst();
  }

  async hasActiveClaim(
    binding: Pick<
      RagSyncBinding,
      'id' | 'workspaceId' | 'spaceId' | 'targetClaimId'
    >,
    targetFingerprint: string,
  ): Promise<boolean> {
    if (!binding.targetClaimId) return false;
    const row = await this.db
      .selectFrom('ragSyncTargetClaims')
      .select('id')
      .where('id', '=', binding.targetClaimId)
      .where('bindingId', '=', binding.id)
      .where('workspaceId', '=', binding.workspaceId)
      .where('spaceId', '=', binding.spaceId)
      .where('targetFingerprint', '=', targetFingerprint)
      .where('state', '=', 'active')
      .executeTakeFirst();
    return Boolean(row);
  }

  async insertClaim(
    workspaceId: string,
    spaceId: string,
    bindingId: string,
    targetFingerprint: string,
    trx: KyselyTransaction,
  ): Promise<RagSyncTargetClaim> {
    return trx
      .insertInto('ragSyncTargetClaims')
      .values({
        workspaceId,
        spaceId,
        bindingId,
        targetFingerprint,
        state: 'active',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async activateClaim(
    claimId: string,
    trx: KyselyTransaction,
  ): Promise<RagSyncTargetClaim> {
    return trx
      .updateTable('ragSyncTargetClaims')
      .set({ state: 'active', updatedAt: sql`clock_timestamp()` })
      .where('id', '=', claimId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async orphanClaim(claimId: string, trx: KyselyTransaction): Promise<void> {
    await trx
      .updateTable('ragSyncTargetClaims')
      .set({ state: 'orphaned', updatedAt: sql`clock_timestamp()` })
      .where('id', '=', claimId)
      .execute();
  }

  async deleteClaim(
    claimId: string,
    owner: Pick<RagSyncBinding, 'id' | 'workspaceId' | 'spaceId'>,
    trx: KyselyTransaction,
  ): Promise<boolean> {
    const result = await trx
      .deleteFrom('ragSyncTargetClaims')
      .where('id', '=', claimId)
      .where('bindingId', '=', owner.id)
      .where('workspaceId', '=', owner.workspaceId)
      .where('spaceId', '=', owner.spaceId)
      .where('state', '=', 'active')
      .executeTakeFirst();
    return result.numDeletedRows === 1n;
  }

  listRunnableBindings(): Promise<RagSyncBinding[]> {
    return this.db
      .selectFrom('ragSyncBindings')
      .selectAll()
      .where('state', 'in', ['enabled', 'draining'])
      .execute();
  }

  async stopForRuntimeError(
    bindingId: string,
    expectedConfigVersion: number,
    expectedTargetVersion: number,
    resetTargetTest: boolean,
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('ragSyncBindings')
      .set({
        state: 'disabled',
        configVersion: expectedConfigVersion + 1,
        ...(resetTargetTest ? { lastTestedAt: null } : {}),
        updatedAt: sql`clock_timestamp()`,
      })
      .where('id', '=', bindingId)
      .where('state', '=', 'enabled')
      .where('configVersion', '=', expectedConfigVersion)
      .where('targetVersion', '=', expectedTargetVersion)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n;
  }

  async completeCleanup(
    bindingId: string,
    expectedConfigVersion: number,
    expectedTargetVersion: number,
  ): Promise<RagSyncBinding | undefined> {
    const binding = await this.findById(bindingId);
    if (!binding) return undefined;
    return this.withSpaceLock(
      binding.workspaceId,
      binding.spaceId,
      async (trx) => {
        const current = await this.findById(bindingId, trx);
        if (
          !current ||
          current.state !== 'draining' ||
          current.configVersion !== expectedConfigVersion ||
          current.targetVersion !== expectedTargetVersion
        ) {
          return undefined;
        }
        const updated = await this.updateBinding(
          current.id,
          {
            state: 'disabled',
            cleanupRequired: false,
            configVersion: current.configVersion + 1,
          },
          trx,
        );
        return updated;
      },
    );
  }

  async completeTargetTest(
    bindingId: string,
    expectedConfigVersion: number,
    expectedTargetVersion: number,
    trx: KyselyTransaction,
  ): Promise<RagSyncBinding | undefined> {
    return trx
      .updateTable('ragSyncBindings')
      .set({
        cleanupRequired: false,
        configVersion: expectedConfigVersion + 1,
        lastTestedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where('id', '=', bindingId)
      .where('state', '=', 'disabled')
      .where('cleanupRequired', '=', true)
      .where('configVersion', '=', expectedConfigVersion)
      .where('targetVersion', '=', expectedTargetVersion)
      .returningAll()
      .executeTakeFirst();
  }

  async assertSpaceDeletionAllowed(spaceId: string): Promise<void> {
    const blocked = await this.db
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
    if (blocked) {
      throw new ConflictException({
        code: 'rag_sync_cleanup_required',
        message: 'Disable RAG sync and complete or abandon cleanup first',
      });
    }
  }

  async assertWorkspaceDeletionAllowed(workspaceId: string): Promise<void> {
    const blocked = await this.db
      .selectFrom('ragSyncBindings')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where((eb) =>
        eb.or([
          eb('state', 'in', ['enabled', 'draining']),
          eb('cleanupRequired', '=', true),
        ]),
      )
      .executeTakeFirst();
    if (blocked) {
      throw new ConflictException({
        code: 'rag_sync_cleanup_required',
        message: 'Disable RAG sync and complete or abandon cleanup first',
      });
    }
  }
}
