import { KyselyTransaction } from '@docmost/db/types/kysely.types';

export const PAGE_HISTORY_EVENT_VERSION = 1 as const;

export type PageHistoryChangeType =
  | 'page.events.combined'
  | 'page.custom-fields.updated'
  | 'page.converted.to-database'
  | 'database.converted.to-page'
  | 'database.property.created'
  | 'database.property.updated'
  | 'database.property.deleted'
  | 'database.row.created'
  | 'database.row.renamed'
  | 'database.row.deleted'
  | 'database.row.cells.updated';

export type PageHistoryChangeData = Record<string, unknown>;

export interface IRecordPageHistoryEventInput {
  pageId: string;
  changeType: PageHistoryChangeType;
  changeData?: PageHistoryChangeData | null;
  actorId?: string | null;
  contributorIds?: string[] | null;
  trx?: KyselyTransaction;
}

export interface IRecordPageHistoryEventsInput {
  pageIds: string[];
  changeType: PageHistoryChangeType;
  changeData?: PageHistoryChangeData | null;
  actorId?: string | null;
  contributorIds?: string[] | null;
  trx?: KyselyTransaction;
}
