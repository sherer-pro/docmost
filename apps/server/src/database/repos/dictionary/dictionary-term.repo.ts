import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import {
  DictionaryTerm,
  DictionaryTermAlias,
  InsertableDictionaryTerm,
  InsertableDictionaryTermAlias,
  UpdatableDictionaryTerm,
} from '@docmost/db/types/entity.types';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';

export interface DictionaryTermWithAliases extends DictionaryTerm {
  aliases: DictionaryTermAlias[];
}

@Injectable()
export class DictionaryTermRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async listBySpace(
    spaceId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<DictionaryTermWithAliases[]> {
    const db = dbOrTx(this.db, trx);
    const terms = await db
      .selectFrom('dictionaryTerms')
      .selectAll()
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('term', 'asc')
      .execute();

    if (terms.length === 0) {
      return [];
    }

    const aliases = await db
      .selectFrom('dictionaryTermAliases')
      .selectAll()
      .where(
        'termId',
        'in',
        terms.map((term) => term.id),
      )
      .orderBy('isPrimary', 'desc')
      .orderBy('alias', 'asc')
      .execute();

    const aliasesByTermId = aliases.reduce<
      Record<string, DictionaryTermAlias[]>
    >((acc, alias) => {
      acc[alias.termId] = acc[alias.termId] ?? [];
      acc[alias.termId].push(alias);
      return acc;
    }, {});

    return terms.map((term) => ({
      ...term,
      aliases: aliasesByTermId[term.id] ?? [],
    }));
  }

  async findById(
    termId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<DictionaryTermWithAliases | undefined> {
    const db = dbOrTx(this.db, trx);
    const term = await db
      .selectFrom('dictionaryTerms')
      .selectAll()
      .where('id', '=', termId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!term) {
      return undefined;
    }

    const aliases = await db
      .selectFrom('dictionaryTermAliases')
      .selectAll()
      .where('termId', '=', term.id)
      .orderBy('isPrimary', 'desc')
      .orderBy('alias', 'asc')
      .execute();

    return { ...term, aliases };
  }

  async findAliasesByNormalized(
    spaceId: string,
    workspaceId: string,
    normalizedAliases: string[],
    opts?: { excludeTermId?: string; trx?: KyselyTransaction },
  ): Promise<DictionaryTermAlias[]> {
    if (normalizedAliases.length === 0) {
      return [];
    }

    const db = dbOrTx(this.db, opts?.trx);
    return db
      .selectFrom('dictionaryTermAliases')
      .selectAll()
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .where('normalizedAlias', 'in', normalizedAliases)
      .$if(Boolean(opts?.excludeTermId), (qb) =>
        qb.where('termId', '!=', opts?.excludeTermId),
      )
      .execute();
  }

  async insertTerm(
    payload: InsertableDictionaryTerm,
    trx?: KyselyTransaction,
  ): Promise<DictionaryTerm> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('dictionaryTerms')
      .values(payload)
      .returningAll()
      .executeTakeFirst();
  }

  async updateTerm(
    termId: string,
    workspaceId: string,
    payload: UpdatableDictionaryTerm,
    trx?: KyselyTransaction,
  ): Promise<DictionaryTerm | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('dictionaryTerms')
      .set({ ...payload, updatedAt: new Date() })
      .where('id', '=', termId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  async softDeleteTerm(
    termId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<DictionaryTerm | undefined> {
    return this.updateTerm(
      termId,
      workspaceId,
      { deletedAt: new Date() },
      trx,
    );
  }

  async deleteAliasesByTermId(
    termId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .deleteFrom('dictionaryTermAliases')
      .where('termId', '=', termId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async insertAliases(
    aliases: InsertableDictionaryTermAlias[],
    trx?: KyselyTransaction,
  ): Promise<DictionaryTermAlias[]> {
    if (aliases.length === 0) {
      return [];
    }

    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('dictionaryTermAliases')
      .values(aliases)
      .returningAll()
      .execute();
  }
}
