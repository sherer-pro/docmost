import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
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
      .where('referenceKind', '=', 'block')
      .execute();
  }

  async findPageByReferencePageId(
    referencePageId: string,
    trx?: KyselyTransaction,
  ): Promise<PageTransclusionReference[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('pageTransclusionReferences')
      .selectAll()
      .where('referencePageId', '=', referencePageId)
      .where('referenceKind', '=', 'page')
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
      .where('referenceKind', '=', 'block')
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
      .where('reference.referenceKind', '=', 'block')
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
          .where('referenceKind', '=', 'block')
          .doNothing(),
      )
      .execute();
  }

  async insertPageMany(
    rows: Array<{
      workspaceId: string;
      referencePageId: string;
      sourcePageId: string;
      referenceNodeId: string;
      referenceKind: 'page';
      transclusionId: null;
    }>,
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (rows.length === 0) return;
    await dbOrTx(this.db, trx)
      .insertInto('pageTransclusionReferences')
      .values(rows)
      .onConflict((oc) =>
        oc
          .columns(['referencePageId', 'referenceNodeId'])
          .where('referenceKind', '=', 'page')
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
      .where('referenceKind', '=', 'block')
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
      .where('referenceKind', '=', 'block')
      .execute();
  }

  async deletePageByReferenceAndNodeIds(
    referencePageId: string,
    referenceNodeIds: string[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (referenceNodeIds.length === 0) return;
    await dbOrTx(this.db, trx)
      .deleteFrom('pageTransclusionReferences')
      .where('referencePageId', '=', referencePageId)
      .where('referenceKind', '=', 'page')
      .where('referenceNodeId', 'in', referenceNodeIds)
      .execute();
  }

  async findPageGraph(
    workspaceId: string,
    trx?: KyselyTransaction,
    limit?: number,
  ): Promise<Array<{ referencePageId: string; sourcePageId: string }>> {
    return dbOrTx(this.db, trx)
      .selectFrom('pageTransclusionReferences')
      .select(['referencePageId', 'sourcePageId'])
      .distinct()
      .where('workspaceId', '=', workspaceId)
      .where('referenceKind', '=', 'page')
      .$if(Boolean(limit), (query) => query.limit(limit!))
      .execute();
  }

  async findPageUsagesBySource(
    sourcePageId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<PageTransclusionReference[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('pageTransclusionReferences')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('sourcePageId', '=', sourcePageId)
      .where('referenceKind', '=', 'page')
      .execute();
  }

  async findUsagesBySource(
    sourcePageId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<PageTransclusionReference[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('pageTransclusionReferences')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('sourcePageId', '=', sourcePageId)
      .execute();
  }

  async lockWorkspaceGraph(
    workspaceId: string,
    trx: KyselyTransaction,
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext(${workspaceId}), 188543327)`.execute(
      trx,
    );
  }
}
