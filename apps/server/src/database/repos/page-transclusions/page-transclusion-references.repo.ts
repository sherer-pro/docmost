import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx, executeTx } from '@docmost/db/utils';
import { sql } from 'kysely';
import {
  InsertablePageTransclusionReference,
  PageTransclusionReference,
} from '@docmost/db/types/entity.types';

export type TransclusionReferenceKey = {
  sourcePageId: string;
  transclusionId: string;
};

@Injectable()
export class PageTransclusionReferencesRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByReferencePageId(
    referencePageId: string,
    trx?: KyselyTransaction,
  ): Promise<PageTransclusionReference[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('pageTransclusionReferences')
      .selectAll()
      .where('referencePageId', '=', referencePageId)
      .execute();
  }

  async findReferencePageIdsByTransclusion(
    sourcePageId: string,
    transclusionId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<string[]> {
    const rows = await dbOrTx(this.db, trx)
      .selectFrom('pageTransclusionReferences')
      .select('referencePageId')
      .distinct()
      .where('workspaceId', '=', workspaceId)
      .where('sourcePageId', '=', sourcePageId)
      .where('transclusionId', '=', transclusionId)
      .execute();
    return rows.map((r) => r.referencePageId);
  }

  async hasLiveReferences(
    sourcePageId: string,
    transclusionId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    const row = await dbOrTx(this.db, trx)
      .selectFrom('pageTransclusionReferences as reference')
      .innerJoin('pages as page', 'page.id', 'reference.referencePageId')
      .select('reference.id')
      .where('reference.workspaceId', '=', workspaceId)
      .where('reference.sourcePageId', '=', sourcePageId)
      .where('reference.transclusionId', '=', transclusionId)
      .where('page.workspaceId', '=', workspaceId)
      .where('page.deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst();

    return Boolean(row);
  }

  async insertMany(
    rows: InsertablePageTransclusionReference[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (rows.length === 0) return;
    await dbOrTx(this.db, trx)
      .insertInto('pageTransclusionReferences')
      .values(rows)
      .onConflict((oc) =>
        oc
          .columns(['referencePageId', 'sourcePageId', 'transclusionId'])
          .doNothing(),
      )
      .execute();
  }

  async deleteByReferenceAndKeys(
    referencePageId: string,
    keys: TransclusionReferenceKey[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (keys.length === 0) return;
    await dbOrTx(this.db, trx)
      .deleteFrom('pageTransclusionReferences')
      .where('referencePageId', '=', referencePageId)
      .where((eb) =>
        eb.or(
          keys.map((k) =>
            eb.and([
              eb('sourcePageId', '=', k.sourcePageId),
              eb('transclusionId', '=', k.transclusionId),
            ]),
          ),
        ),
      )
      .execute();
  }

  async deleteOne(
    referencePageId: string,
    sourcePageId: string,
    transclusionId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('pageTransclusionReferences')
      .where('referencePageId', '=', referencePageId)
      .where('sourcePageId', '=', sourcePageId)
      .where('transclusionId', '=', transclusionId)
      .execute();
  }
  async findConsumerSpaceIdsBySourcePageIds(
    sourcePageIds: string[],
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<string[]> {
    if (sourcePageIds.length === 0) return [];
    const rows = await dbOrTx(this.db, trx)
      .selectFrom('pageTransclusionReferences as reference')
      .innerJoin('pages as consumer', 'consumer.id', 'reference.referencePageId')
      .select('consumer.spaceId')
      .distinct()
      .where('reference.workspaceId', '=', workspaceId)
      .where('reference.sourcePageId', 'in', [...new Set(sourcePageIds)])
      .where('consumer.workspaceId', '=', workspaceId)
      .where('consumer.deletedAt', 'is', null)
      .execute();
    return rows.map((row) => row.spaceId);
  }

  async withWorkspaceMutationLock<T>(
    workspaceId: string,
    callback: (trx: KyselyTransaction) => Promise<T>,
  ): Promise<T> {
    return executeTx(this.db, async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${workspaceId}), 188543327)`.execute(
        trx,
      );
      return callback(trx);
    });
  }
}
