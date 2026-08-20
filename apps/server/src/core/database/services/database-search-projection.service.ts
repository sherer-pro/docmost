import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import type { DatabasePropertyType } from '@docmost/api-contract';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import type { SearchDatabaseMatchDto } from '../../search/dto/search-response.dto';

const INDEXABLE_PROPERTY_TYPES = new Set<DatabasePropertyType>([
  'multiline_text',
  'code',
  'select',
  'user',
]);
const MAX_CELL_BYTES = 20_000;
const MAX_ROW_BYTES = 1_000_000;
const MAX_MATCHES_PER_ROW = 3;
const MATCH_CONTEXT_CHARS = 80;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProjectionCell {
  propertyId: string;
  propertyName: string;
  propertyType: string | null;
  propertySettings: unknown;
  propertyPosition: number | null;
  value: unknown;
}

export interface DatabaseSearchCellProjection {
  propertyId: string;
  propertyName: string;
  value: string;
}

@Injectable()
export class DatabaseSearchProjectionService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async refreshRow(
    pageId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    const cells = await this.loadCells([pageId], workspaceId, trx);
    const projections = await this.buildCellProjections(
      cells,
      workspaceId,
      trx,
    );
    const searchText = this.joinProjectionValues(projections.get(pageId) ?? []);

    await db
      .updateTable('pages')
      .set({ databaseSearchText: searchText })
      .where('id', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async refreshDatabase(
    databaseId: string,
    workspaceId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .selectFrom('databaseRows')
      .innerJoin('pages', 'pages.id', 'databaseRows.pageId')
      .select('databaseRows.pageId')
      .where('databaseRows.databaseId', '=', databaseId)
      .where('databaseRows.workspaceId', '=', workspaceId)
      .where('databaseRows.archivedAt', 'is', null)
      .where('pages.deletedAt', 'is', null)
      .orderBy('databaseRows.pageId', 'asc')
      .execute();
    const pageIds = rows.map((row) => row.pageId);
    await this.refreshPages(pageIds, workspaceId);
    return pageIds;
  }

  async refreshWorkspace(workspaceId?: string): Promise<string[]> {
    let query = this.db
      .selectFrom('databaseRows')
      .innerJoin('pages', 'pages.id', 'databaseRows.pageId')
      .select(['databaseRows.pageId', 'databaseRows.workspaceId'])
      .where('databaseRows.archivedAt', 'is', null)
      .where('pages.deletedAt', 'is', null)
      .orderBy('databaseRows.workspaceId', 'asc')
      .orderBy('databaseRows.pageId', 'asc');
    if (workspaceId) {
      query = query.where('databaseRows.workspaceId', '=', workspaceId);
    }

    const rows = await query.execute();
    const byWorkspace = new Map<string, string[]>();
    for (const row of rows) {
      byWorkspace.set(row.workspaceId, [
        ...(byWorkspace.get(row.workspaceId) ?? []),
        row.pageId,
      ]);
    }
    for (const [currentWorkspaceId, pageIds] of byWorkspace) {
      await this.refreshPages(pageIds, currentWorkspaceId);
    }
    return rows.map((row) => row.pageId);
  }

  async refreshRowsForUser(
    userId: string,
    workspaceId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .selectFrom('databaseCells')
      .innerJoin(
        'databaseProperties',
        'databaseProperties.id',
        'databaseCells.propertyId',
      )
      .innerJoin('databaseRows', (join) =>
        join
          .onRef('databaseRows.databaseId', '=', 'databaseCells.databaseId')
          .onRef('databaseRows.pageId', '=', 'databaseCells.pageId'),
      )
      .select('databaseCells.pageId')
      .distinct()
      .where('databaseCells.workspaceId', '=', workspaceId)
      .where('databaseCells.deletedAt', 'is', null)
      .where('databaseProperties.deletedAt', 'is', null)
      .where('databaseProperties.type', '=', 'user')
      .where('databaseRows.archivedAt', 'is', null)
      .where(
        sql<boolean>`LOWER(${sql.ref('databaseCells.value')}::text) LIKE ${`%${userId.toLowerCase()}%`}`,
      )
      .execute();
    const pageIds = rows.map((row) => row.pageId);
    await this.refreshPages(pageIds, workspaceId);
    return pageIds;
  }

  async buildMatches(
    pageIds: string[],
    workspaceId: string,
    query: string,
  ): Promise<Map<string, SearchDatabaseMatchDto[]>> {
    if (pageIds.length === 0 || !query.trim()) {
      return new Map();
    }
    const cells = await this.loadCells(pageIds, workspaceId);
    const projections = await this.buildCellProjections(cells, workspaceId);
    const matchesByPageId = new Map<string, SearchDatabaseMatchDto[]>();

    for (const pageId of pageIds) {
      const matches = (projections.get(pageId) ?? [])
        .map((cell) => this.buildMatch(cell, query))
        .filter((match): match is SearchDatabaseMatchDto => Boolean(match))
        .slice(0, MAX_MATCHES_PER_ROW);
      if (matches.length > 0) {
        matchesByPageId.set(pageId, matches);
      }
    }
    return matchesByPageId;
  }

  async refreshPages(pageIds: string[], workspaceId: string): Promise<void> {
    const uniqueIds = [...new Set(pageIds)];
    const batchSize = 250;
    for (let index = 0; index < uniqueIds.length; index += batchSize) {
      const batch = uniqueIds.slice(index, index + batchSize);
      const cells = await this.loadCells(batch, workspaceId);
      const projections = await this.buildCellProjections(cells, workspaceId);
      await this.db.transaction().execute(async (trx) => {
        for (const pageId of batch) {
          await trx
            .updateTable('pages')
            .set({
              databaseSearchText: this.joinProjectionValues(
                projections.get(pageId) ?? [],
              ),
            })
            .where('id', '=', pageId)
            .where('workspaceId', '=', workspaceId)
            .execute();
        }
      });
    }
  }

  private async loadCells(
    pageIds: string[],
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<Array<ProjectionCell & { pageId: string }>> {
    if (pageIds.length === 0) return [];
    return dbOrTx(this.db, trx)
      .selectFrom('databaseCells')
      .innerJoin(
        'databaseProperties',
        'databaseProperties.id',
        'databaseCells.propertyId',
      )
      .innerJoin('databaseRows', (join) =>
        join
          .onRef('databaseRows.databaseId', '=', 'databaseCells.databaseId')
          .onRef('databaseRows.pageId', '=', 'databaseCells.pageId'),
      )
      .select([
        'databaseCells.pageId',
        'databaseCells.propertyId',
        'databaseCells.value',
        'databaseProperties.name as propertyName',
        'databaseProperties.type as propertyType',
        'databaseProperties.settings as propertySettings',
        'databaseProperties.position as propertyPosition',
      ])
      .where('databaseCells.workspaceId', '=', workspaceId)
      .where('databaseCells.pageId', 'in', pageIds)
      .where('databaseCells.deletedAt', 'is', null)
      .where('databaseProperties.deletedAt', 'is', null)
      .where('databaseRows.archivedAt', 'is', null)
      .orderBy('databaseProperties.position', 'asc')
      .orderBy('databaseProperties.createdAt', 'asc')
      .orderBy('databaseCells.id', 'asc')
      .execute();
  }

  private async buildCellProjections(
    cells: Array<ProjectionCell & { pageId: string }>,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<Map<string, DatabaseSearchCellProjection[]>> {
    const userIds = [
      ...new Set(
        cells
          .filter((cell) => cell.propertyType === 'user')
          .map((cell) => this.extractReferenceId(cell.value))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const users =
      userIds.length > 0
        ? await dbOrTx(this.db, trx)
            .selectFrom('users')
            .select(['id', 'name'])
            .where('workspaceId', '=', workspaceId)
            .where('id', 'in', userIds)
            .execute()
        : [];
    const userNames = new Map(users.map((user) => [user.id, user.name]));
    const result = new Map<string, DatabaseSearchCellProjection[]>();

    for (const cell of cells) {
      const propertyType = this.normalizePropertyType(cell.propertyType);
      if (!INDEXABLE_PROPERTY_TYPES.has(propertyType)) continue;
      const value = this.toDisplayValue(cell, userNames);
      if (!value) continue;
      result.set(cell.pageId, [
        ...(result.get(cell.pageId) ?? []),
        {
          propertyId: cell.propertyId,
          propertyName: cell.propertyName || cell.propertyId,
          value: this.truncateUtf8(value, MAX_CELL_BYTES),
        },
      ]);
    }
    return result;
  }

  private toDisplayValue(
    cell: ProjectionCell,
    userNames: ReadonlyMap<string, string>,
  ): string {
    const propertyType = this.normalizePropertyType(cell.propertyType);
    if (propertyType === 'user') {
      const userId = this.extractReferenceId(cell.value);
      return userId ? (userNames.get(userId)?.trim() ?? '') : '';
    }
    if (propertyType === 'select') {
      const selected = this.extractSelectValue(cell.value);
      if (!selected) return '';
      const option = this.extractSelectOptions(cell.propertySettings).find(
        (candidate) =>
          candidate.value === selected || candidate.label === selected,
      );
      const displayValue = (option?.label ?? selected).trim();
      return UUID_PATTERN.test(displayValue) ? '' : displayValue;
    }

    const current = this.unwrapValue(cell.value);
    if (typeof current !== 'string') return '';
    const normalized = this.normalizeSerializedString(current).trim();
    if (!normalized || UUID_PATTERN.test(normalized)) return '';
    try {
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed === 'object') return '';
    } catch {
      // Plain text is indexable.
    }
    return normalized;
  }

  private buildMatch(
    cell: DatabaseSearchCellProjection,
    query: string,
  ): SearchDatabaseMatchDto | null {
    const value = cell.value.replace(/\s+/g, ' ').trim();
    const match = this.findNormalizedMatch(value, query);
    if (!match) return null;
    const matchAt = match.start;
    const matchLength = match.end - match.start;

    const start = Math.max(0, matchAt - MATCH_CONTEXT_CHARS);
    const end = Math.min(
      value.length,
      matchAt + matchLength + MATCH_CONTEXT_CHARS,
    );
    const text = `${start > 0 ? '…' : ''}${value.slice(start, end)}${
      end < value.length ? '…' : ''
    }`;
    const prefixLength = start > 0 ? 1 : 0;
    const localStart = prefixLength + matchAt - start;
    return {
      propertyId: cell.propertyId,
      propertyName: cell.propertyName,
      text,
      matches: [
        {
          start: localStart,
          end: localStart + matchLength,
          value: value.slice(matchAt, matchAt + matchLength),
        },
      ],
    };
  }

  private joinProjectionValues(cells: DatabaseSearchCellProjection[]): string {
    let result = '';
    for (const cell of cells) {
      const next = result ? `${result}\n${cell.value}` : cell.value;
      if (Buffer.byteLength(next, 'utf8') > MAX_ROW_BYTES) {
        return this.truncateUtf8(next, MAX_ROW_BYTES);
      }
      result = next;
    }
    return result;
  }

  private findNormalizedMatch(
    value: string,
    query: string,
  ): { start: number; end: number } | null {
    const normalize = (text: string) =>
      text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    const queryCandidates = [
      normalize(query).trim(),
      ...normalize(query).trim().split(/\s+/).filter(Boolean),
    ];
    const normalizedCharacters: string[] = [];
    const originalOffsets: number[] = [];
    let originalOffset = 0;
    for (const character of value) {
      for (const part of normalize(character)) {
        normalizedCharacters.push(part);
        originalOffsets.push(originalOffset);
      }
      originalOffset += character.length;
    }
    const normalizedValue = normalizedCharacters.join('');
    for (const candidate of queryCandidates) {
      const index = normalizedValue.indexOf(candidate);
      if (index < 0) continue;
      const start = originalOffsets[index] ?? 0;
      const last = originalOffsets[index + candidate.length - 1] ?? start;
      return {
        start,
        end: last + (value.codePointAt(last)! > 0xffff ? 2 : 1),
      };
    }
    return null;
  }

  private normalizePropertyType(type: string | null): DatabasePropertyType {
    return (type === 'text' ? 'multiline_text' : type) as DatabasePropertyType;
  }

  private unwrapValue(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return value;
    const candidate = value as Record<string, unknown>;
    return 'value' in candidate && 'rawValueBeforeTypeChange' in candidate
      ? candidate.value
      : value;
  }

  private normalizeSerializedString(value: string): string {
    let current = value;
    for (let index = 0; index < 6; index += 1) {
      const trimmed = current.trim();
      if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) break;
      try {
        const parsed = JSON.parse(current);
        if (typeof parsed !== 'string') break;
        current = parsed;
      } catch {
        break;
      }
    }
    return current;
  }

  private extractReferenceId(value: unknown): string | null {
    const current = this.unwrapValue(value);
    if (typeof current === 'string') {
      const normalized = current.trim();
      if (!normalized) return null;
      try {
        return this.extractReferenceId(JSON.parse(normalized)) ?? normalized;
      } catch {
        return normalized;
      }
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    const candidate = current as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id : null;
    return id?.trim() || null;
  }

  private extractSelectValue(value: unknown): string | null {
    const current = this.unwrapValue(value);
    if (typeof current === 'string') {
      const normalized = current.trim();
      if (!normalized) return null;
      try {
        return this.extractSelectValue(JSON.parse(normalized)) ?? normalized;
      } catch {
        return normalized;
      }
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    const candidate = current as Record<string, unknown>;
    const selected =
      typeof candidate.value === 'string'
        ? candidate.value
        : typeof candidate.label === 'string'
          ? candidate.label
          : null;
    return selected?.trim() || null;
  }

  private extractSelectOptions(
    settings: unknown,
  ): Array<{ value: string; label: string }> {
    if (!settings || typeof settings !== 'object') return [];
    const options = (settings as { options?: unknown }).options;
    if (!Array.isArray(options)) return [];
    return options.flatMap((option) => {
      if (!option || typeof option !== 'object') return [];
      const candidate = option as Record<string, unknown>;
      if (
        typeof candidate.value !== 'string' ||
        typeof candidate.label !== 'string'
      ) {
        return [];
      }
      return [{ value: candidate.value, label: candidate.label }];
    });
  }

  private truncateUtf8(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
    let low = 0;
    let high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return value.slice(0, low);
  }
}
