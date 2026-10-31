import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { validate as isUuid } from 'uuid';
import {
  AI_DATABASE_LIMITS,
  AiDatabaseContext,
  AiDatabaseCellOperation,
  AiDatabaseApprovalPreview,
  normalizeDatabaseViewState,
  normalizeDatabaseValue,
  unwrapDatabaseValue,
  databaseUserIds,
  isDatabaseComputedProperty,
  DatabaseViewState,
  formatDatabaseValue,
  getDatabaseViewPropertyIds,
} from '@docmost/api-contract';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page-access/page-access.service';
import { AiContentPolicyService } from '../../ai-content-policy/ai-content-policy.service';
import {
  DatabaseViewQueryService,
  DatabaseViewQueryInput,
} from '../../database/services/database-view-query.service';
import { DatabaseService } from '../../database/services/database.service';
import { databaseSchemaFingerprint } from '../../../common/helpers/database-schema.util';
export { databaseSchemaFingerprint } from '../../../common/helpers/database-schema.util';

export function normalizeAiDatabaseContext(value: unknown): AiDatabaseContext {
  const input = value as AiDatabaseContext;
  if (
    !input ||
    typeof input !== 'object' ||
    !isUuid(input.databaseId ?? '') ||
    (input.viewId !== undefined && !isUuid(input.viewId)) ||
    (input.groupKey !== undefined &&
      (typeof input.groupKey !== 'string' || input.groupKey.length > 1000)) ||
    !Array.isArray(input.selectedPageIds) ||
    input.selectedPageIds.length > 200 ||
    input.selectedPageIds.some((id) => typeof id !== 'string' || !isUuid(id)) ||
    new Set(input.selectedPageIds).size !== input.selectedPageIds.length
  ) {
    throw new BadRequestException('Invalid database context');
  }
  try {
    const result = {
      databaseId: input.databaseId,
      viewId: input.viewId,
      groupKey: input.groupKey,
      viewState: normalizeDatabaseViewState(input.viewState),
      selectedPageIds: input.selectedPageIds,
    };
    if (input.groupKey !== undefined) {
      const value = JSON.parse(input.groupKey);
      if (
        !result.viewState.groupBy ||
        (value !== null && !['string', 'boolean'].includes(typeof value))
      )
        throw new Error();
    }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 16384)
      throw new Error();
    return result;
  } catch {
    throw new BadRequestException('Invalid database view state');
  }
}

type ExecutionContext = {
  user: User;
  workspaceId: string;
  spaceId: string;
  currentPageId?: string;
  databaseContext?: AiDatabaseContext;
};

@Injectable()
export class AiDatabaseService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly access: PageAccessService,
    private readonly policy: AiContentPolicyService,
    private readonly query: DatabaseViewQueryService,
    private readonly databases: DatabaseService,
  ) {}

  async scope(databaseId: string, context: ExecutionContext, state?: unknown) {
    if (!isUuid(databaseId ?? ''))
      throw new BadRequestException('Invalid database ID');
    const database = await this.db
      .selectFrom('databases')
      .selectAll()
      .where('id', '=', databaseId)
      .where('workspaceId', '=', context.workspaceId)
      .where('spaceId', '=', context.spaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!database?.pageId) throw new NotFoundException('Database not found');
    const [snapshot, excluded, properties] = await Promise.all([
      this.access.getSidebarAccessSnapshot(context.user, context.spaceId),
      this.policy.getExcludedPageIds(context.spaceId, context.workspaceId),
      this.db
        .selectFrom('databaseProperties')
        .select(['id', 'name', 'type', 'settings'])
        .where('databaseId', '=', databaseId)
        .where('workspaceId', '=', context.workspaceId)
        .where('deletedAt', 'is', null)
        .orderBy('position')
        .execute(),
    ]);
    if (
      !snapshot.readablePageIds.has(database.pageId) ||
      excluded.has(database.pageId)
    ) {
      throw new NotFoundException('Database not found');
    }
    const saved =
      context.databaseContext?.databaseId === databaseId
        ? context.databaseContext
        : undefined;
    let readablePageIds = [...snapshot.readablePageIds].filter(
      (id) => !excluded.has(id),
    );
    const referenceReadablePageIds = readablePageIds;
    if (saved?.selectedPageIds.length) {
      const allowed = new Set(readablePageIds);
      if (saved.selectedPageIds.some((id) => !allowed.has(id)))
        throw new ForbiddenException(
          'Database selection is no longer accessible',
        );
      readablePageIds = saved.selectedPageIds;
    }
    const normalized = properties.map((p) => ({
      ...p,
      type: p.type === 'text' ? 'multiline_text' : p.type,
    }));
    return {
      database,
      properties: normalized,
      snapshot,
      excluded,
      input: {
        databaseId,
        workspaceId: context.workspaceId,
        spaceId: context.spaceId,
        readablePageIds,
        referenceReadablePageIds,
        groupKey: saved?.groupKey,
        properties: normalized,
        state: this.query.validateState(
          state ?? saved?.viewState ?? {},
          normalized,
        ),
      },
    };
  }

  async read(
    args: Record<string, unknown>,
    context: ExecutionContext,
    summary: boolean,
  ) {
    const scoped = await this.scope(
      String(args.databaseId ?? ''),
      context,
      args.viewState,
    );
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute((trx) => this.readSnapshot(args, context, summary, trx, scoped));
  }

  private async referenceDependencies(
    input: DatabaseViewQueryInput,
    reader: KyselyDB | KyselyTransaction = this.db,
  ): Promise<string[]> {
    const used = new Set(getDatabaseViewPropertyIds(input.state));
    const properties = input.properties.filter(
      (property) => property.type === 'page_reference' && used.has(property.id),
    );
    if (!properties.length || !input.readablePageIds.length) return [];
    const allowed = new Set(
      input.referenceReadablePageIds ?? input.readablePageIds,
    );
    const cells = await reader
      .selectFrom('databaseCells')
      .select('value')
      .where('databaseId', '=', input.databaseId)
      .where('workspaceId', '=', input.workspaceId)
      .where('pageId', 'in', input.readablePageIds)
      .where(
        'propertyId',
        'in',
        properties.map((property) => property.id),
      )
      .where('deletedAt', 'is', null)
      .execute();
    return [
      ...new Set(
        cells
          .map((cell) => {
            const value = unwrapDatabaseValue(cell.value);
            return typeof value === 'string' ? value : (value as any)?.id;
          })
          .filter(
            (id): id is string => typeof id === 'string' && allowed.has(id),
          ),
      ),
    ];
  }

  private async readSnapshot(
    args: Record<string, unknown>,
    context: ExecutionContext,
    summary: boolean,
    trx: KyselyTransaction,
    scoped: Awaited<ReturnType<AiDatabaseService['scope']>>,
  ) {
    const database = await trx
      .selectFrom('databases')
      .selectAll()
      .where('id', '=', scoped.database.id)
      .where('workspaceId', '=', context.workspaceId)
      .where('spaceId', '=', context.spaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!database || database.pageId !== scoped.database.pageId)
      throw new ConflictException('Database source changed');
    const properties = (
      await trx
        .selectFrom('databaseProperties')
        .select(['id', 'name', 'type', 'settings'])
        .where('databaseId', '=', database.id)
        .where('deletedAt', 'is', null)
        .orderBy('position')
        .execute()
    ).map((p) => ({
      ...p,
      type: p.type === 'text' ? 'multiline_text' : p.type,
    }));
    scoped.database = database;
    scoped.properties = properties;
    scoped.input.properties = properties;
    scoped.input.state = this.query.validateState(
      scoped.input.state,
      properties,
    );
    const input = {
      ...scoped.input,
      trx,
      viewId:
        context.databaseContext?.databaseId === scoped.database.id
          ? context.databaseContext.viewId
          : undefined,
    };
    const filterReferences = await this.referenceDependencies(input, trx);
    if (summary) {
      const totals = await this.query.summary(input);
      return {
        dependencyPageIds: [
          ...new Set([
            ...(await this.query.matchingPageIds(input)),
            ...filterReferences,
          ]),
        ],
        databaseId: scoped.database.id,
        viewState: scoped.input.state,
        groupKey: scoped.input.state.groupBy
          ? scoped.input.groupKey
          : undefined,
        ...totals,
        scope: 'accessible_ai_allowed_rows',
        complete: !Object.keys(totals.errors ?? {}).length,
        ...(Object.keys(totals.errors ?? {}).length
          ? { warnings: ['formula_errors'] }
          : {}),
      };
    }
    const limit = args.limit === undefined ? 20 : Number(args.limit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (args.cursor !== undefined &&
        (typeof args.cursor !== 'string' || args.cursor.length > 4096))
    ) {
      throw new BadRequestException('Invalid database pagination');
    }
    const result = await this.query.list(input, {
      limit,
      cursor: args.cursor as string,
    });
    const ids = result.items.map((row: any) => row.pageId);
    const cells = result.items.flatMap((row: any) =>
      (row.cells ?? []).map((cell) => ({ ...cell, pageId: row.pageId })),
    );
    const visible = scoped.input.state.visibleColumns;
    const referenced = (value: unknown) =>
      typeof value === 'string' ? value : (value as any)?.id;
    const references = cells
      .filter(
        (cell) =>
          scoped.properties.find((p) => p.id === cell.propertyId)?.type ===
            'page_reference' && visible[cell.propertyId] !== false,
      )
      .map((cell) => referenced(unwrapDatabaseValue(cell.value)))
      .filter(
        (id): id is string =>
          typeof id === 'string' &&
          scoped.snapshot.readablePageIds.has(id) &&
          !scoped.excluded.has(id),
      );
    return {
      dependencyPageIds: [
        ...new Set([...ids, ...references, ...filterReferences]),
      ],
      databaseId: scoped.database.id,
      viewState: scoped.input.state,
      groupKey: scoped.input.state.groupBy ? scoped.input.groupKey : undefined,
      properties: scoped.properties.filter((p) => visible[p.id] !== false),
      items: result.items.map((row: any) => ({
        pageId: row.pageId,
        title: row.title ?? row.pageTitle ?? row.page?.title ?? '',
        cells: cells
          .filter(
            (cell) =>
              cell.pageId === row.pageId && visible[cell.propertyId] !== false,
          )
          .map((cell) => ({
            propertyId: cell.propertyId,
            value:
              scoped.properties.find((p) => p.id === cell.propertyId)?.type ===
              'page_reference'
                ? references.includes(
                    referenced(unwrapDatabaseValue(cell.value)),
                  )
                  ? referenced(unwrapDatabaseValue(cell.value))
                  : null
                : unwrapDatabaseValue(cell.value),
            revision: cell.revision,
          })),
      })),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      truncated: result.hasMore,
      scope: 'accessible_ai_allowed_rows',
    };
  }

  async propose(args: Record<string, unknown>, context: ExecutionContext) {
    const scoped = await this.scope(String(args.databaseId ?? ''), context);
    if (
      scoped.database.pageId !== context.currentPageId ||
      context.databaseContext?.databaseId !== scoped.database.id
    ) {
      throw new ForbiddenException(
        'Select the current database before proposing cell changes',
      );
    }
    const rows = args.rows as AiDatabaseCellOperation['rows'];
    if (
      !Array.isArray(rows) ||
      rows.length < 1 ||
      rows.length > AI_DATABASE_LIMITS.rows ||
      new Set(rows.map((r) => r?.pageId)).size !== rows.length
    )
      throw new BadRequestException('Invalid database proposal rows');
    const input = {
      ...scoped.input,
      state: { ...scoped.input.state, sorts: [] } as DatabaseViewState,
    };
    const previewRows: AiDatabaseApprovalPreview['rows'] = [];
    const operations: AiDatabaseCellOperation['rows'] = [];
    let cellCount = 0;
    for (const row of rows) {
      if (
        !row ||
        !isUuid(row.pageId ?? '') ||
        !Array.isArray(row.cells) ||
        !row.cells.length ||
        new Set(row.cells.map((c) => c?.propertyId)).size !==
          row.cells.length ||
        (cellCount += row.cells.length) > AI_DATABASE_LIMITS.cells ||
        !scoped.snapshot.writablePageIds?.has(row.pageId)
      ) {
        throw new BadRequestException('Invalid or inaccessible proposal row');
      }
      // A model cannot broaden the frozen view or the explicit row selection.
      const match = await this.query.list(
        {
          ...input,
          readablePageIds: input.readablePageIds.filter(
            (id) => id === row.pageId,
          ),
        },
        { limit: 1 },
      );
      if (!match.items.length)
        throw new ForbiddenException(
          'Row is outside the selected database view',
        );
      const existing = await this.db
        .selectFrom('databaseCells')
        .selectAll()
        .where('databaseId', '=', scoped.database.id)
        .where('pageId', '=', row.pageId)
        .where('workspaceId', '=', context.workspaceId)
        .where('deletedAt', 'is', null)
        .execute();
      const changes: AiDatabaseApprovalPreview['rows'][number]['cells'] = [];
      for (const cell of row.cells) {
        const property = scoped.properties.find(
          (p) => p.id === cell?.propertyId,
        );
        if (
          !property ||
          isDatabaseComputedProperty(property?.type) ||
          property?.type === 'file' ||
          !Number.isInteger(cell.expectedRevision) ||
          cell.expectedRevision < 0 ||
          Object.keys(cell).some(
            (key) => !['propertyId', 'value', 'expectedRevision'].includes(key),
          ) ||
          !Object.prototype.hasOwnProperty.call(cell, 'value')
        )
          throw new BadRequestException('Invalid database proposal cell');
        const before = existing.find((c) => c.propertyId === property.id);
        if (property.type === 'page_reference' && before?.value) {
          const value = unwrapDatabaseValue(before.value);
          const id = typeof value === 'string' ? value : (value as any)?.id;
          if (
            id &&
            (!scoped.snapshot.readablePageIds.has(id) ||
              scoped.excluded.has(id))
          )
            throw new ForbiddenException(
              'Existing page reference is inaccessible',
            );
        }
        if (before?.attachmentId)
          throw new BadRequestException('AI cannot modify attachment cells');
        if (cell.expectedRevision !== (before?.revision ?? 0))
          throw new ConflictException('Database cell was changed');
        let value: unknown;
        try {
          value = normalizeDatabaseValue(
            property.type as any,
            cell.value,
            property.settings as any,
          );
        } catch {
          throw new BadRequestException('Invalid database cell value');
        }
        if (property.type === 'page_reference' && value) {
          if (
            !scoped.snapshot.readablePageIds.has(String(value)) ||
            scoped.excluded.has(String(value))
          )
            throw new ForbiddenException('Page reference is inaccessible');
        }
        if (property.type === 'user' && value) {
          const userIds = databaseUserIds(value);
          const assignable = await this.access.getAssignableSpaceUserIds(
            userIds,
            context.spaceId,
            context.workspaceId,
          );
          if (userIds.some((id) => !assignable.has(id)))
            throw new BadRequestException('User is not an active space member');
        }
        changes.push({
          propertyId: property.id,
          propertyName: property.name,
          before: unwrapDatabaseValue(before?.value ?? null),
          beforeDisplay: formatDatabaseValue(
            property.type,
            unwrapDatabaseValue(before?.value ?? null),
            property.settings,
            context.user.locale,
          ),
          afterDisplay: formatDatabaseValue(
            property.type,
            value,
            property.settings,
            context.user.locale,
          ),
          value,
          expectedRevision: cell.expectedRevision,
        });
      }
      const title =
        (match.items[0] as any).title ??
        (match.items[0] as any).page?.title ??
        '';
      previewRows.push({ pageId: row.pageId, title, cells: changes });
      operations.push({
        pageId: row.pageId,
        cells: changes.map(({ propertyId, value, expectedRevision }) => ({
          propertyId,
          value,
          expectedRevision,
        })),
      });
    }
    const preview: AiDatabaseApprovalPreview = {
      kind: 'databaseCells',
      databaseId: scoped.database.id,
      pageId: scoped.database.pageId,
      pageTitle: scoped.database.name,
      beforeText: '',
      afterText: '',
      truncated: false,
      rows: previewRows,
    };
    const operation: AiDatabaseCellOperation = {
      kind: 'databaseCells',
      databaseId: scoped.database.id,
      schemaFingerprint: databaseSchemaFingerprint(scoped.properties),
      rows: operations,
    };
    if (
      Buffer.byteLength(JSON.stringify({ preview, operation }), 'utf8') >
      AI_DATABASE_LIMITS.previewBytes
    ) {
      throw new BadRequestException(
        'Database proposal is too large; reduce the selection',
      );
    }
    return {
      content: { approvalPreview: preview, requiresApproval: true },
      dependencyPageIds: [
        ...new Set([
          scoped.database.pageId,
          ...(await this.referenceDependencies(input)),
          ...operations.map((row) => row.pageId),
          ...previewRows.flatMap((row) =>
            row.cells
              .filter(
                (cell) =>
                  scoped.properties.find((p) => p.id === cell.propertyId)
                    ?.type === 'page_reference',
              )
              .flatMap((cell) =>
                [cell.value, cell.before]
                  .map((v) => (typeof v === 'string' ? v : (v as any)?.id))
                  .filter((id): id is string => typeof id === 'string'),
              ),
          ),
        ]),
      ],
      writeProposal: {
        pageId: scoped.database.pageId,
        baseContentHash: null,
        expectedAfterHash: null,
        operation,
      },
    };
  }

  async apply(
    operation: AiDatabaseCellOperation,
    context: ExecutionContext,
    trx: KyselyTransaction,
  ) {
    const scoped = await this.scope(operation.databaseId, context);
    if (
      scoped.database.pageId !== context.currentPageId ||
      context.databaseContext?.databaseId !== operation.databaseId ||
      operation.kind !== 'databaseCells' ||
      !Array.isArray(operation.rows) ||
      !operation.rows.length ||
      operation.rows.length > AI_DATABASE_LIMITS.rows ||
      operation.rows.reduce((n, r) => n + r.cells.length, 0) >
        AI_DATABASE_LIMITS.cells
    ) {
      throw new ForbiddenException('Database write is not allowed');
    }
    const updatedRows: string[] = [];
    const failedRows: Array<{ pageId: string; code: string }> = [];
    for (const row of operation.rows) {
      await sql`savepoint ai_database_row`.execute(trx);
      try {
        if (
          !scoped.input.readablePageIds.includes(row.pageId) ||
          !scoped.snapshot.writablePageIds?.has(row.pageId)
        )
          throw new ForbiddenException();
        await this.databases.batchUpdateRowCells(
          operation.databaseId,
          row.pageId,
          { cells: row.cells, contractVersion: 4 },
          context.user,
          context.workspaceId,
          {
            trx,
            requireExistingRow: true,
            schemaFingerprint: operation.schemaFingerprint,
          },
        );
        updatedRows.push(row.pageId);
      } catch (error) {
        await sql`rollback to savepoint ai_database_row`.execute(trx);
        failedRows.push({
          pageId: row.pageId,
          code:
            error instanceof ConflictException
              ? 'conflict'
              : error instanceof ForbiddenException
                ? 'forbidden'
                : 'invalid_value',
        });
      }
      await sql`release savepoint ai_database_row`.execute(trx);
    }
    return {
      ok: true,
      applied: updatedRows.length > 0,
      updatedRows,
      failedRows,
    };
  }

  async refreshSearch(pageIds: string[]) {
    for (const pageId of pageIds)
      await this.databases.enqueuePageSearchRefresh(pageId);
  }
}
