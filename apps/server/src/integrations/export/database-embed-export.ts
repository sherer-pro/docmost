import { BadRequestException } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import {
  normalizeDatabaseViewState,
  formatDatabaseValue,
  unwrapDatabaseValue,
} from '@docmost/api-contract';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../core/page-access/page-access.service';
import { DatabaseViewQueryService } from '../../core/database/services/database-view-query.service';

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
});

export async function materializeDatabaseEmbeds(
  content: unknown,
  db: KyselyDB,
  access: PageAccessService,
  user?: User,
  preserveDatabaseIds = new Set<string>(),
  materializedPageIds?: Set<string>,
): Promise<any> {
  const query = new DatabaseViewQueryService(db, new DatabaseRowRepo(db));
  const cache = new Map<string, any>();
  const resolve = async (attrs: any) => {
    const key = JSON.stringify([attrs?.databaseId, attrs?.viewId]);
    if (cache.has(key)) return cache.get(key);
    const unavailable = () => paragraph('[Database view unavailable]');
    if (
      !user ||
      !isUuid(attrs?.databaseId ?? '') ||
      (attrs?.viewId && !isUuid(attrs.viewId))
    )
      return unavailable();
    const database = await db
      .selectFrom('databases')
      .selectAll()
      .where('id', '=', attrs.databaseId)
      .where('workspaceId', '=', user.workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!database?.pageId) return unavailable();
    const snapshot = await access.getSidebarAccessSnapshot(
      user,
      database.spaceId,
    );
    if (!snapshot.readablePageIds.has(database.pageId)) return unavailable();
    materializedPageIds?.add(database.pageId);
    const properties = await db
      .selectFrom('databaseProperties')
      .selectAll()
      .where('databaseId', '=', database.id)
      .where('deletedAt', 'is', null)
      .orderBy('position')
      .execute();
    const view = attrs.viewId
      ? await db
          .selectFrom('databaseViews')
          .selectAll()
          .where('id', '=', attrs.viewId)
          .where('databaseId', '=', database.id)
          .where('deletedAt', 'is', null)
          .executeTakeFirst()
      : null;
    if (attrs.viewId && !view) return unavailable();
    const state = query.validateState(
      normalizeDatabaseViewState(view?.config),
      properties,
    );
    const visible = properties.filter(
      (p) => state.visibleColumns[p.id] !== false,
    );
    const rank = (id: string) =>
      state.columnOrder?.includes(id)
        ? state.columnOrder.indexOf(id)
        : (state.columnOrder?.length ?? 0) +
          properties.findIndex((p) => p.id === id);
    visible.sort((a, b) => rank(a.id) - rank(b.id));
    const cell = (text: string, header = false) => ({
      type: header ? 'tableHeader' : 'tableCell',
      content: [paragraph(text)],
    });
    const rows: any[] = [
      {
        type: 'tableRow',
        content: [
          cell('Title', true),
          ...visible.map((p) => cell(p.name, true)),
        ],
      },
    ];
    let cursor: string | undefined;
    let count = 0;
    await db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        do {
          const page = await query.list(
            {
              databaseId: database.id,
              workspaceId: user.workspaceId,
              spaceId: database.spaceId,
              properties,
              state,
              viewId: view?.id,
              readablePageIds: [...snapshot.readablePageIds],
              trx,
            },
            { limit: 200, cursor },
          );
          count += page.items.length;
          if (count > 10000)
            throw new BadRequestException(
              'Embedded view export exceeds 10000 rows; narrow its filter',
            );
          for (const row of page.items as any[]) {
            materializedPageIds?.add(row.pageId);
            rows.push({
              type: 'tableRow',
              content: [
                cell(row.pageTitle ?? row.page?.title ?? ''),
                ...visible.map((property) => {
                  let value = unwrapDatabaseValue(
                    row.cells?.find((c: any) => c.propertyId === property.id)
                      ?.value ?? null,
                  );
                  if (property.type === 'page_reference') {
                    const id =
                      typeof value === 'string' ? value : (value as any)?.id;
                    if (!snapshot.readablePageIds.has(id)) value = null;
                  }
                  return cell(
                    formatDatabaseValue(
                      property.type,
                      value,
                      property.settings,
                      user.locale,
                    ),
                  );
                }),
              ],
            });
          }
          cursor = page.hasMore ? (page.nextCursor ?? undefined) : undefined;
        } while (cursor);
      });
    const result = [
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: database.name?.trim() || 'Database' }],
      },
      { type: 'table', content: rows },
    ];
    cache.set(key, result);
    return result;
  };
  const walk = async (node: any): Promise<any> => {
    if (!node || typeof node !== 'object') return node;
    if (
      node.type === 'databaseEmbed' &&
      !preserveDatabaseIds.has(node.attrs?.databaseId)
    )
      return resolve(node.attrs);
    if (!Array.isArray(node.content)) return node;
    return {
      ...node,
      content: (await Promise.all(node.content.map(walk))).flat(),
    };
  };
  return walk(content);
}
