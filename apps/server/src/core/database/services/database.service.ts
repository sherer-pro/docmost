import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { DatabaseCellRepo } from '@docmost/db/repos/database/database-cell.repo';
import { DatabasePropertyRepo } from '@docmost/db/repos/database/database-property.repo';
import { DatabaseViewRepo } from '@docmost/db/repos/database/database-view.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { User } from '@docmost/db/types/entity.types';
import { PageService } from '../../page/services/page.service';
import { ExportService } from '../../../integrations/export/export.service';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import {
  BatchUpdateDatabaseCellsDto,
  BatchUpdateDatabaseRowsDto,
  DatabaseExportFormat,
  CreateDatabaseDto,
  CreateDatabasePropertyDto,
  CreateDatabaseRowDto,
  CreateDatabaseViewDto,
  ListDatabaseRowsQueryDto,
  UpdateDatabaseRowDto,
  UpdateDatabaseDto,
  UpdateDatabasePropertyDto,
  UpdateDatabaseViewDto,
} from '../dto/database.dto';
import type { DatabasePropertyType } from '@docmost/api-contract';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { IPageRecipientNotificationJob } from '../../../integrations/queue/constants/queue.interface';
import { PageHistoryRecorderService } from '../../page/services/page-history-recorder.service';
import { generateSlugId } from '../../../common/helpers';

interface IDatabaseCellValueWithFallback {
  value: unknown;
  rawValueBeforeTypeChange: unknown;
  rawTypeBeforeTypeChange?: DatabasePropertyType | string | null;
}

interface IDatabaseUserCellValue {
  id: string;
  name?: string;
}

interface IDatabasePageReferenceCellValue {
  id: string;
  title: string;
  slugId: string | null;
}

interface IDatabaseHistorySelectOption {
  value: string;
  label: string;
}

interface IDatabaseRowsFilterCondition {
  propertyId: string;
  operator: 'contains' | 'equals' | 'not_equals';
  value: string;
}

/**
 * Extended response contract for updateDatabase:
 * in addition to the database itself, we return the current slug of the linked page,
 * so that the client can synchronously update the URL after the rename.
 */
export interface IUpdatedDatabaseResponse {
  pageSlugId: string | null;
}

export interface IUpdatedDatabaseRowResponse {
  pageId: string;
  title: string;
  slugId: string;
}

export interface IListDatabaseRowsResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const MAX_DATABASE_ROW_FILTERS = 10;
const SERIALIZED_STRING_NORMALIZE_DEPTH = 6;
const BOOLEAN_TRUE_TOKENS = new Set(['true', '1', 'yes', 'on']);
const BOOLEAN_FALSE_TOKENS = new Set(['false', '0', 'no', 'off', '']);

@Injectable()
export class DatabaseService {
  constructor(
    private readonly databaseRepo: DatabaseRepo,
    private readonly databaseRowRepo: DatabaseRowRepo,
    private readonly databaseCellRepo: DatabaseCellRepo,
    private readonly databasePropertyRepo: DatabasePropertyRepo,
    private readonly databaseViewRepo: DatabaseViewRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageService: PageService,
    private readonly exportService: ExportService,
    private readonly userRepo: UserRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageHistoryRecorder: PageHistoryRecorderService,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  /**
   * Legacy type `text` is no longer supported by the contract.
   * For backward compatibility, let's normalize it to `multiline_text`
   * before any read/convert operations.
   */
  private normalizePropertyType(type: string | null | undefined): DatabasePropertyType {
    if (type === 'text') {
      return 'multiline_text';
    }

    return type as DatabasePropertyType;
  }

  /**
   * Casts property types to the actual contract in API responses.
   */
  private normalizeProperties<T extends { type: string | null }>(properties: T[]): T[] {
    return properties.map((property) => ({
      ...property,
      type: this.normalizePropertyType(property.type),
    }));
  }

  /**
   * Checks database access within the current workspace.
   *
   * If the record is not found, a 404 is thrown - this is a single point of validation
   * for all nested resources (properties/rows/cells/views).
   */
  private async getOrFailDatabase(databaseId: string, workspaceId: string) {
    const database = await this.databaseRepo.findById(databaseId, workspaceId);
    if (!database) {
      throw new NotFoundException('Database not found');
    }

    return database;
  }

  private async buildDatabaseHistoryTargetPageIds(
    databaseId: string,
    workspaceId: string,
    spaceId: string,
    extras: string[] = [],
  ): Promise<string[]> {
    const rows = await this.databaseRowRepo.findByDatabaseId(
      databaseId,
      workspaceId,
      spaceId,
    );
    const rowPageIds = (rows ?? [])
      .map((row) => row.pageId)
      .filter((pageId): pageId is string => Boolean(pageId));

    return [...new Set([...rowPageIds, ...extras])];
  }

  private async recordDatabaseHistoryEvent(params: {
    pageIds: string[];
    actorId?: string | null;
    changeType:
      | 'database.property.created'
      | 'database.property.updated'
      | 'database.property.deleted'
      | 'database.row.created'
      | 'database.row.renamed'
      | 'database.row.deleted'
      | 'database.row.cells.updated';
    changeData: Record<string, unknown>;
  }): Promise<void> {
    if (params.pageIds.length === 0) {
      return;
    }

    await this.pageHistoryRecorder.enqueuePageEvents({
      pageIds: params.pageIds,
      actorId: params.actorId,
      changeType: params.changeType,
      changeData: params.changeData,
    });
  }

  /**
   * Escapes a custom value for a markdown table cell.
   */
  private escapeMarkdownCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  /**
   * Converts an arbitrary cell value to a safe string.
   */
  private stringifyCellValue(value: unknown): string {
    const normalizedValue = this.extractCurrentCellValue(value);

    if (normalizedValue === null || typeof normalizedValue === 'undefined') {
      return '';
    }

    if (typeof normalizedValue === 'string') {
      return normalizedValue;
    }

    return JSON.stringify(normalizedValue);
  }

  /**
   * Returns the active value of a cell taking into account the fallback container.
   */
  private extractCurrentCellValue(value: unknown): unknown {
    if (!this.isCellFallbackValue(value)) {
      return value;
    }

    return value.value;
  }

  /**
   * Checks that the value is stored in the fallback container format.
   */
  private isCellFallbackValue(value: unknown): value is IDatabaseCellValueWithFallback {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return 'value' in candidate && 'rawValueBeforeTypeChange' in candidate;
  }

  /**
   * Returns the original value for the reverse type change script.
   */
  private extractValueForConversion(value: unknown): unknown {
    if (!this.isCellFallbackValue(value)) {
      return value;
    }

    if (value.value === null || typeof value.value === 'undefined') {
      return value.rawValueBeforeTypeChange;
    }

    return value.value;
  }

  /**
   * Returns fallback source type if it exists in the legacy conversion payload.
   */
  private extractFallbackSourceType(value: unknown): DatabasePropertyType | null {
    if (!this.isCellFallbackValue(value)) {
      return null;
    }

    const sourceType = value.rawTypeBeforeTypeChange;
    if (typeof sourceType !== 'string') {
      return null;
    }

    return this.normalizePropertyType(sourceType);
  }

  /**
   * Resolves user display name for user->text conversions.
   */
  private async resolveUserDisplayValue(
    value: unknown,
    workspaceId: string,
    cache: Map<string, string>,
  ): Promise<string | null> {
    const userId = this.extractUserIdFromCellValue(value);
    if (!userId) {
      return null;
    }

    const cachedName = cache.get(userId);
    if (cachedName) {
      return cachedName;
    }

    const displayValue = (await this.resolveUserNameById(userId, workspaceId)) || userId;
    cache.set(userId, displayValue);
    return displayValue;
  }

  private async resolveUserNameById(
    userId: string,
    workspaceId: string,
  ): Promise<string | null> {
    try {
      const user = await this.userRepo.findById(userId, workspaceId);
      return user?.name?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves page identifier from cell value.
   * Supports string payload and object payload (`{ id }`, `{ pageId }`).
   */
  private extractPageIdFromCellValue(value: unknown): string | null {
    const currentValue = this.extractCurrentCellValue(value);

    if (typeof currentValue === 'string') {
      const normalizedValue = currentValue.trim();
      if (!normalizedValue) {
        return null;
      }

      try {
        const parsedValue = JSON.parse(normalizedValue);
        const parsedPageId = this.extractPageIdFromCellValue(parsedValue);
        if (parsedPageId) {
          return parsedPageId;
        }
      } catch {
        // Keep normalized string fallback below.
      }

      return normalizedValue;
    }

    if (!currentValue || typeof currentValue !== 'object') {
      return null;
    }

    const candidate = currentValue as Record<string, unknown>;
    const rawPageId =
      typeof candidate.id === 'string'
        ? candidate.id
        : typeof candidate.pageId === 'string'
          ? candidate.pageId
          : null;

    return rawPageId?.trim() || null;
  }

  /**
   * Resolves user cell value to a display-ready history payload.
   */
  private async resolveHistoryUserValue(
    value: unknown,
    workspaceId: string,
    cache: Map<string, string>,
  ): Promise<IDatabaseUserCellValue | null> {
    const userId = this.extractUserIdFromCellValue(value);
    if (!userId) {
      return null;
    }

    const cachedName = cache.get(userId);
    if (cachedName) {
      return { id: userId, name: cachedName };
    }

    const userName = (await this.resolveUserNameById(userId, workspaceId)) || userId;
    cache.set(userId, userName);
    return { id: userId, name: userName };
  }

  /**
   * Resolves page_reference value to page id/title/slug payload.
   */
  private async resolveHistoryPageReferenceValue(
    value: unknown,
    workspaceId: string,
    cache: Map<string, IDatabasePageReferenceCellValue>,
  ): Promise<IDatabasePageReferenceCellValue | null> {
    const pageId = this.extractPageIdFromCellValue(value);
    if (!pageId) {
      return null;
    }

    const cachedPageRef = cache.get(pageId);
    if (cachedPageRef) {
      return cachedPageRef;
    }

    const page = await this.pageRepo.findById(pageId);
    const canUsePageMeta =
      !!page && page.workspaceId === workspaceId && page.deletedAt === null;
    const pageRef: IDatabasePageReferenceCellValue = {
      id: pageId,
      title: canUsePageMeta ? page.title?.trim() || pageId : pageId,
      slugId: canUsePageMeta ? page.slugId ?? null : null,
    };

    cache.set(pageId, pageRef);
    return pageRef;
  }

  private extractSelectOptionsFromSettings(
    settings: unknown,
  ): IDatabaseHistorySelectOption[] {
    if (!settings || typeof settings !== 'object') {
      return [];
    }

    const options = (settings as { options?: unknown }).options;
    if (!Array.isArray(options)) {
      return [];
    }

    return options
      .filter((option): option is IDatabaseHistorySelectOption => {
        if (!option || typeof option !== 'object') {
          return false;
        }

        const candidate = option as IDatabaseHistorySelectOption;
        return (
          typeof candidate.value === 'string' && typeof candidate.label === 'string'
        );
      })
      .map((option) => ({
        value: option.value,
        label: option.label,
      }));
  }

  private extractSelectOptionValue(value: unknown): string | null {
    const currentValue = this.extractCurrentCellValue(value);

    if (typeof currentValue === 'string') {
      const normalizedValue = currentValue.trim();
      if (!normalizedValue) {
        return null;
      }

      try {
        const parsedValue = JSON.parse(normalizedValue);
        const parsedOptionValue = this.extractSelectOptionValue(parsedValue);
        if (parsedOptionValue) {
          return parsedOptionValue;
        }
      } catch {
        // Keep normalized string fallback below.
      }

      return normalizedValue;
    }

    if (!currentValue || typeof currentValue !== 'object') {
      return null;
    }

    const candidate = currentValue as Record<string, unknown>;
    const rawValue =
      typeof candidate.value === 'string'
        ? candidate.value
        : typeof candidate.label === 'string'
          ? candidate.label
          : null;

    return rawValue?.trim() || null;
  }

  private resolveHistorySelectValue(
    value: unknown,
    settings: unknown,
  ): IDatabaseHistorySelectOption | null {
    const optionValue = this.extractSelectOptionValue(value);
    if (!optionValue) {
      return null;
    }

    const options = this.extractSelectOptionsFromSettings(settings);
    const matchedOption = options.find(
      (option) => option.value === optionValue || option.label === optionValue,
    );

    if (matchedOption) {
      return matchedOption;
    }

    return {
      value: optionValue,
      label: optionValue,
    };
  }

  /**
   * Normalizes history payload value for readable timeline output.
   */
  private async resolveHistoryCellValue(params: {
    propertyType: DatabasePropertyType | null;
    propertySettings: unknown;
    value: unknown;
    workspaceId: string;
    userNameCache: Map<string, string>;
    pageReferenceCache: Map<string, IDatabasePageReferenceCellValue>;
  }): Promise<unknown> {
    if (params.value === null || typeof params.value === 'undefined') {
      return null;
    }

    if (params.propertyType === 'user') {
      const userValue = await this.resolveHistoryUserValue(
        params.value,
        params.workspaceId,
        params.userNameCache,
      );

      return userValue ?? this.extractCurrentCellValue(params.value);
    }

    if (params.propertyType === 'page_reference') {
      const pageRefValue = await this.resolveHistoryPageReferenceValue(
        params.value,
        params.workspaceId,
        params.pageReferenceCache,
      );

      return pageRefValue ?? this.extractCurrentCellValue(params.value);
    }

    if (params.propertyType === 'select') {
      const selectValue = this.resolveHistorySelectValue(
        params.value,
        params.propertySettings,
      );

      return selectValue ?? this.extractCurrentCellValue(params.value);
    }

    return this.extractCurrentCellValue(params.value);
  }

  private async enrichRowsWithUserNames(
    rows: any[],
    userPropertyIds: Set<string>,
    workspaceId: string,
  ): Promise<any[]> {
    if (!rows?.length || userPropertyIds.size === 0) {
      return rows;
    }

    const userIds = [...new Set(
      rows.flatMap((row) =>
        (row?.cells ?? [])
          .filter((cell) => userPropertyIds.has(cell.propertyId))
          .map((cell) => this.extractUserIdFromCellValue(cell.value))
          .filter((userId): userId is string => Boolean(userId)),
      ),
    )];

    if (userIds.length === 0) {
      return rows;
    }

    const userDisplayEntries = await Promise.all(
      userIds.map(async (userId) => [
        userId,
        (await this.resolveUserNameById(userId, workspaceId)) || userId,
      ] as const),
    );

    const userNameById = new Map(userDisplayEntries);

    return rows.map((row) => ({
      ...row,
      cells: (row?.cells ?? []).map((cell) => {
        if (!userPropertyIds.has(cell.propertyId)) {
          return cell;
        }

        const userId = this.extractUserIdFromCellValue(cell.value);
        if (!userId) {
          return cell;
        }

        return {
          ...cell,
          value: {
            id: userId,
            name: userNameById.get(userId) ?? userId,
          },
        };
      }),
    }));
  }

  private normalizeSerializedRowString(value: string): string {
    let normalizedValue = value;

    for (
      let normalizeIteration = 0;
      normalizeIteration < SERIALIZED_STRING_NORMALIZE_DEPTH;
      normalizeIteration += 1
    ) {
      const trimmedValue = normalizedValue.trim();
      if (!trimmedValue.startsWith('"') || !trimmedValue.endsWith('"')) {
        break;
      }

      try {
        const parsedValue = JSON.parse(normalizedValue);
        if (typeof parsedValue !== 'string') {
          break;
        }

        normalizedValue = parsedValue;
      } catch {
        break;
      }
    }

    return normalizedValue;
  }

  private normalizeCheckboxCellValue(value: unknown): boolean {
    const currentValue = this.extractCurrentCellValue(value);

    if (typeof currentValue === 'boolean') {
      return currentValue;
    }

    if (typeof currentValue === 'string') {
      const normalizedToken = this.normalizeSerializedRowString(currentValue)
        .trim()
        .toLowerCase();

      if (BOOLEAN_TRUE_TOKENS.has(normalizedToken)) {
        return true;
      }

      if (BOOLEAN_FALSE_TOKENS.has(normalizedToken)) {
        return false;
      }

      return Boolean(normalizedToken);
    }

    if (currentValue === null || typeof currentValue === 'undefined') {
      return false;
    }

    return Boolean(currentValue);
  }

  private extractUserNameFromCellValue(value: unknown): string | null {
    const currentValue = this.extractCurrentCellValue(value);
    if (!currentValue || typeof currentValue !== 'object' || !('name' in currentValue)) {
      return null;
    }

    const candidate = (currentValue as IDatabaseUserCellValue).name;
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
  }

  private parseRowsFilters(rawFilters?: string): IDatabaseRowsFilterCondition[] {
    if (!rawFilters) {
      return [];
    }

    let parsedFilters: unknown;
    try {
      parsedFilters = JSON.parse(rawFilters);
    } catch {
      throw new BadRequestException('Invalid rows filters');
    }

    if (!Array.isArray(parsedFilters)) {
      throw new BadRequestException('Invalid rows filters');
    }

    const normalizedFilters: IDatabaseRowsFilterCondition[] = [];
    for (const rawCondition of parsedFilters) {
      if (!rawCondition || typeof rawCondition !== 'object') {
        throw new BadRequestException('Invalid rows filters');
      }

      const condition = rawCondition as Record<string, unknown>;
      if (
        typeof condition.propertyId !== 'string' ||
        typeof condition.operator !== 'string' ||
        typeof condition.value !== 'string'
      ) {
        throw new BadRequestException('Invalid rows filters');
      }

      if (
        condition.operator !== 'contains' &&
        condition.operator !== 'equals' &&
        condition.operator !== 'not_equals'
      ) {
        throw new BadRequestException('Invalid rows filters');
      }

      if (!condition.propertyId || !condition.value) {
        continue;
      }

      normalizedFilters.push({
        propertyId: condition.propertyId,
        operator: condition.operator,
        value: condition.value,
      });
      if (normalizedFilters.length >= MAX_DATABASE_ROW_FILTERS) {
        break;
      }
    }

    return normalizedFilters;
  }

  private async resolvePageTitlesById(
    rows: any[],
    propertiesById: Map<string, { id: string; type: string | null }>,
    workspaceId: string,
  ): Promise<Map<string, string>> {
    const pageReferencePropertyIds = new Set(
      [...propertiesById.values()]
        .filter((property) => this.normalizePropertyType(property.type) === 'page_reference')
        .map((property) => property.id),
    );

    if (pageReferencePropertyIds.size === 0 || rows.length === 0) {
      return new Map();
    }

    const pageIds = [...new Set(
      rows.flatMap((row) =>
        (row?.cells ?? [])
          .filter((cell) => pageReferencePropertyIds.has(cell.propertyId))
          .map((cell) => this.extractPageIdFromCellValue(cell.value))
          .filter((pageId): pageId is string => Boolean(pageId)),
      ),
    )];

    if (pageIds.length === 0) {
      return new Map();
    }

    const pages = await this.db
      .selectFrom('pages')
      .select(['id', 'title'])
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .where('id', 'in', pageIds)
      .execute();

    const pageTitleById = new Map<string, string>();
    for (const page of pages) {
      pageTitleById.set(page.id, page.title?.trim() || page.id);
    }

    for (const pageId of pageIds) {
      if (!pageTitleById.has(pageId)) {
        pageTitleById.set(pageId, pageId);
      }
    }

    return pageTitleById;
  }

  private getRowCellDisplayValue(params: {
    row: any;
    propertyId: string;
    propertiesById: Map<string, { id: string; type: string | null; settings?: unknown }>;
    pageTitleById: Map<string, string>;
  }): string {
    const property = params.propertiesById.get(params.propertyId);
    const rawCellValue = params.row?.cells?.find(
      (cell) => cell.propertyId === params.propertyId,
    )?.value;
    const currentValue = this.extractCurrentCellValue(rawCellValue);

    if (!property) {
      if (typeof currentValue === 'string') {
        return this.normalizeSerializedRowString(currentValue);
      }

      if (currentValue === null || typeof currentValue === 'undefined') {
        return '';
      }

      return JSON.stringify(currentValue);
    }

    const normalizedPropertyType = this.normalizePropertyType(property.type);
    if (normalizedPropertyType === 'user') {
      const userName = this.extractUserNameFromCellValue(rawCellValue);
      if (userName) {
        return userName;
      }

      return this.extractUserIdFromCellValue(rawCellValue) || '';
    }

    if (normalizedPropertyType === 'select') {
      const optionValue = this.extractSelectOptionValue(rawCellValue);
      if (!optionValue) {
        return '';
      }

      const optionLabel =
        this.extractSelectOptionsFromSettings(property.settings)
          .find((option) => option.value === optionValue || option.label === optionValue)
          ?.label ?? null;

      return optionLabel || optionValue;
    }

    if (normalizedPropertyType === 'page_reference') {
      const pageId = this.extractPageIdFromCellValue(rawCellValue);
      if (!pageId) {
        return '';
      }

      return params.pageTitleById.get(pageId) || pageId;
    }

    if (normalizedPropertyType === 'checkbox') {
      return String(this.normalizeCheckboxCellValue(rawCellValue));
    }

    if (typeof currentValue === 'string') {
      return this.normalizeSerializedRowString(currentValue);
    }

    if (currentValue === null || typeof currentValue === 'undefined') {
      return '';
    }

    return JSON.stringify(currentValue);
  }

  private matchesRowsFilterCondition(
    value: string,
    condition: IDatabaseRowsFilterCondition,
  ): boolean {
    const normalizedValue = value.toLowerCase();
    const normalizedFilter = condition.value.toLowerCase();

    if (condition.operator === 'equals') {
      return normalizedValue === normalizedFilter;
    }

    if (condition.operator === 'not_equals') {
      return normalizedValue !== normalizedFilter;
    }

    return normalizedValue.includes(normalizedFilter);
  }

  private applyRowsServerState(params: {
    rows: any[];
    filters: IDatabaseRowsFilterCondition[];
    sortPropertyId?: string;
    sortDirection?: 'asc' | 'desc';
    propertiesById: Map<string, { id: string; type: string | null; settings?: unknown }>;
    pageTitleById: Map<string, string>;
  }): any[] {
    const filteredRows = params.rows.filter((row) =>
      params.filters.every((condition) => {
        const cellDisplayValue = this.getRowCellDisplayValue({
          row,
          propertyId: condition.propertyId,
          propertiesById: params.propertiesById,
          pageTitleById: params.pageTitleById,
        });
        return this.matchesRowsFilterCondition(cellDisplayValue, condition);
      }),
    );

    if (!params.sortPropertyId) {
      return filteredRows;
    }

    const sortDirection = params.sortDirection === 'desc' ? 'desc' : 'asc';

    return [...filteredRows].sort((left, right) => {
      const leftValue = this.getRowCellDisplayValue({
        row: left,
        propertyId: params.sortPropertyId,
        propertiesById: params.propertiesById,
        pageTitleById: params.pageTitleById,
      });
      const rightValue = this.getRowCellDisplayValue({
        row: right,
        propertyId: params.sortPropertyId,
        propertiesById: params.propertiesById,
        pageTitleById: params.pageTitleById,
      });

      const result = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: 'base',
      });

      if (result !== 0) {
        return sortDirection === 'asc' ? result : -result;
      }

      const leftPosition = String(left?.pagePosition ?? left?.page?.position ?? '');
      const rightPosition = String(right?.pagePosition ?? right?.page?.position ?? '');
      return leftPosition.localeCompare(rightPosition, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
  }

  /**
   * Determines whether the current type can be automatically cast to the target type.
   */
  private canConvertToType(nextType: DatabasePropertyType): boolean {
    return !['user', 'checkbox', 'page_reference', 'select'].includes(nextType);
  }

  /**
   * Attempts to convert a value to the target property type.
   */
  private async convertCellValueByPropertyType(
    value: unknown,
    fromType: DatabasePropertyType,
    toType: DatabasePropertyType,
    workspaceId: string,
    userDisplayCache: Map<string, string>,
  ): Promise<{ converted: unknown; isConvertible: boolean; isRollback: boolean }> {
    const fallbackSourceType = this.extractFallbackSourceType(value);
    if (fallbackSourceType && fallbackSourceType === toType) {
      return {
        converted: (value as IDatabaseCellValueWithFallback).rawValueBeforeTypeChange,
        isConvertible: true,
        isRollback: true,
      };
    }

    if (
      this.isCellFallbackValue(value) &&
      !fallbackSourceType &&
      (value.value === null || typeof value.value === 'undefined')
    ) {
      return {
        converted: value.rawValueBeforeTypeChange,
        isConvertible: true,
        isRollback: true,
      };
    }

    const normalizedValue = this.extractValueForConversion(value);

    if (normalizedValue === null || typeof normalizedValue === 'undefined') {
      return { converted: null, isConvertible: true, isRollback: false };
    }

    if (!this.canConvertToType(toType)) {
      return { converted: normalizedValue, isConvertible: false, isRollback: false };
    }

    if (fromType === 'checkbox' && toType === 'multiline_text') {
      if (typeof normalizedValue === 'boolean') {
        return {
          converted: normalizedValue ? 'Yes' : 'No',
          isConvertible: true,
          isRollback: false,
        };
      }

      const booleanValue = String(normalizedValue).toLowerCase() === 'true';
      return { converted: booleanValue ? 'Yes' : 'No', isConvertible: true, isRollback: false };
    }

    if (fromType === 'select' && toType === 'multiline_text') {
      if (typeof normalizedValue === 'string') {
        return { converted: normalizedValue, isConvertible: true, isRollback: false };
      }

      if (typeof normalizedValue === 'object') {
        const option = normalizedValue as Record<string, unknown>;
        const optionLabel = option.label;
        const optionValue = option.value;
        if (typeof optionLabel === 'string') {
          return { converted: optionLabel, isConvertible: true, isRollback: false };
        }

        if (typeof optionValue === 'string') {
          return { converted: optionValue, isConvertible: true, isRollback: false };
        }
      }
    }

    if (fromType === 'user' && (toType === 'multiline_text' || toType === 'code')) {
      const userDisplayValue = await this.resolveUserDisplayValue(
        normalizedValue,
        workspaceId,
        userDisplayCache,
      );

      if (userDisplayValue !== null) {
        return { converted: userDisplayValue, isConvertible: true, isRollback: false };
      }
    }

    if (value === null || typeof value === 'undefined') {
      return { converted: null, isConvertible: true, isRollback: false };
    }

    if (toType === 'multiline_text' || toType === 'code') {
      if (typeof normalizedValue === 'string') {
        return { converted: normalizedValue, isConvertible: true, isRollback: false };
      }

      return { converted: JSON.stringify(normalizedValue), isConvertible: true, isRollback: false };
    }

    return { converted: normalizedValue, isConvertible: true, isRollback: false };
  }

  /**
   * Converts property cell values when changing type.
   */
  private async convertPropertyCellValues(
    databaseId: string,
    propertyId: string,
    fromType: DatabasePropertyType,
    toType: DatabasePropertyType,
    workspaceId: string,
    spaceId: string,
  ): Promise<void> {
    const rows =
      (await this.databaseRowRepo.findByDatabaseId(databaseId, workspaceId, spaceId)) ?? [];
    const userDisplayCache = new Map<string, string>();

    for (const row of rows) {
      const cells = await this.databaseCellRepo.findByDatabaseAndPage(databaseId, row.pageId);
      const targetCell = cells.find((cell) => cell.propertyId === propertyId);

      if (!targetCell) {
        continue;
      }

      const { converted, isConvertible, isRollback } = await this.convertCellValueByPropertyType(
        targetCell.value,
        fromType,
        toType,
        workspaceId,
        userDisplayCache,
      );

      const nextValue = isRollback
        ? converted
        : {
            value: isConvertible ? converted : null,
            rawValueBeforeTypeChange: this.extractCurrentCellValue(targetCell.value),
            rawTypeBeforeTypeChange: fromType,
          };

      await this.databaseCellRepo.updateCell(targetCell.id, {
        value: nextValue as never,
      });
    }
  }

  /**
   * Collects a markdown representation of the current database table.
   */
  async buildDatabaseMarkdown(databaseId: string, user: User, workspaceId: string) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanReadDatabasePages(user, database.spaceId);

    const [properties, rows] = await Promise.all([
      this.databasePropertyRepo.findByDatabaseId(databaseId),
      this.databaseRowRepo.findByDatabaseId(databaseId, workspaceId, database.spaceId),
    ]);

    const title = database.name?.trim() || 'Database';
    const header = ['Title', ...properties.map((property) => property.name || 'Column')];
    const separator = header.map(() => '---');

    const tableRows = rows.map((row) => {
      const titleCell = row.page?.title || row.pageTitle || '';
      const valueByPropertyId = new Map<string, string>(
        (row.cells ?? []).map((cell) => [cell.propertyId, this.stringifyCellValue(cell.value)]),
      );

      return [
        this.escapeMarkdownCell(titleCell),
        ...properties.map((property) =>
          this.escapeMarkdownCell(valueByPropertyId.get(property.id) ?? ''),
        ),
      ];
    });

    const table = [header, separator, ...tableRows]
      .map((line) => `| ${line.join(' | ')} |`)
      .join('\n');

    return `# ${title}\n\n${table}`;
  }

  /**
   * Generates a minimal valid PDF document with text content.
   */
  private createSimplePdfBuffer(content: string): Buffer {
    const escapePdfText = (value: string) =>
      value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    const textLines = content
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(0, 80);

    const textCommands = textLines
      .map((line, index) => `1 0 0 1 50 ${770 - index * 14} Tm (${escapePdfText(line)}) Tj`)
      .join('\n');

    const stream = `BT\n/F1 10 Tf\n${textCommands}\nET`;
    const streamLength = Buffer.byteLength(stream, 'utf8');

    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
      `4 0 obj << /Length ${streamLength} >> stream\n${stream}\nendstream endobj`,
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    ];

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];

    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += `${object}\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i += 1) {
      pdf += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
    }

    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, 'utf8');
  }

  /**
   * Exports the database to markdown or pdf.
   */
  async exportDatabase(
    databaseId: string,
    format: DatabaseExportFormat,
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanReadDatabasePages(user, database.spaceId);
    const safeName = (database.name?.trim() || 'database').replace(/\s+/g, '-').toLowerCase();

    if (format === DatabaseExportFormat.PDF) {
      const markdown = await this.buildDatabaseMarkdown(databaseId, user, workspaceId);
      return {
        contentType: 'application/pdf',
        fileName: `${safeName}.pdf`,
        fileBuffer: this.createSimplePdfBuffer(markdown),
      };
    }

    if (!database.pageId) {
      throw new NotFoundException('Database root page not found');
    }

    /**
     * For markdown export we use the standard Docmost mechanism for pages:
     * - a zip archive is generated,
     * - child pages (base rows) are included,
     * - docmost-metadata.json is automatically added.
     */
    const zipFileStream = await this.exportService.exportPages(
      database.pageId,
      DatabaseExportFormat.Markdown,
      false,
      true,
    );

    return {
      contentType: 'application/zip',
      fileName: `${safeName}.zip`,
      fileStream: zipFileStream,
    };
  }

  /**
   * Checks the user's right to read pages in the database space.
   */
  private async assertCanReadDatabasePages(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  /**
   * Checks the user's right to modify pages in the database space.
   */
  private async assertCanManageDatabasePages(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  /**
   * Validates the target page of a row within the workspace/space and excludes removed pages.
   */
  private async assertCanAccessTargetPage(
    pageId: string,
    workspaceId: string,
    spaceId: string,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== workspaceId || page.spaceId !== spaceId) {
      throw new NotFoundException('Page not found');
    }

    if (page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
  }

  /**
   * Creates a new database in the specified workspace/space.
   */
  async createDatabase(
    dto: CreateDatabaseDto,
    actorId: string,
    workspaceId: string,
  ) {
    const normalizedName = dto.name?.trim() || 'Untitled database';

    /**
     * Create an “anchor” database page.
     *
     * This page stores the canonical position and parent in a single tree,
     * therefore sidebar and DnD work according to the same rules as for regular pages.
     */
    const databasePage = await this.pageService.create(actorId, workspaceId, {
      title: normalizedName,
      icon: dto.icon,
      parentPageId: dto.parentPageId ?? null,
      spaceId: dto.spaceId,
    });

    return this.databaseRepo.insertDatabase({
      spaceId: dto.spaceId,
      name: normalizedName,
      description: dto.description,
      descriptionContent: dto.descriptionContent as never,
      icon: dto.icon,
      workspaceId,
      creatorId: actorId,
      lastUpdatedById: actorId,
      pageId: databasePage.id,
    });
  }

  /**
   * Returns one database by ID.
   */
  async getDatabase(databaseId: string, workspaceId: string) {
    return this.getOrFailDatabase(databaseId, workspaceId);
  }

  /**
   * Returns a list of databases in the space.
   */
  async listBySpace(spaceId: string, workspaceId: string) {
    return this.databaseRepo.findBySpaceId(spaceId, workspaceId);
  }

  /**
   * Updates database metadata.
   */
  async updateDatabase(
    databaseId: string,
    dto: UpdateDatabaseDto,
    actorId: string,
    workspaceId: string,
  ): Promise<Awaited<ReturnType<DatabaseRepo['updateDatabase']>> & IUpdatedDatabaseResponse> {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    const hasNameChanged = typeof dto.name === 'string' && dto.name !== database.name;

    const updated = await this.databaseRepo.updateDatabase(databaseId, workspaceId, {
      ...dto,
      descriptionContent: dto.descriptionContent as never,
      lastUpdatedById: actorId,
    });

    if (!updated) {
      throw new NotFoundException('Database not found');
    }

    let pageSlugId: string | null = null;

    /**
     * Keep database-page rename behavior aligned with regular page rename:
     * only update the page title and actor metadata, without regenerating slug.
     */
    if (database.pageId && hasNameChanged) {
      await this.pageRepo.updatePage(
        {
          title: updated.name,
          lastUpdatedById: actorId,
          workspaceId,
        },
        database.pageId,
      );

      const linkedPage = await this.pageRepo.findById(database.pageId);
      if (linkedPage?.workspaceId === workspaceId) {
        pageSlugId = linkedPage.slugId;
      }
    }

    return {
      ...updated,
      pageSlugId,
    };
  }

  /**
   * Performs a soft delete of the database.
   */
  async deleteDatabase(databaseId: string, workspaceId: string) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);

    await this.databaseCellRepo.softDeleteByDatabaseId(databaseId, workspaceId);
    await this.databaseViewRepo.softDeleteByDatabaseId(databaseId, workspaceId);

    if (database.pageId) {
      const pages = await this.pageRepo.getPageAndDescendants(database.pageId, {
        includeContent: false,
      });

      await this.databaseRowRepo.archiveByPageIds(
        databaseId,
        workspaceId,
        pages.map((page) => page.id),
      );

      await this.pageRepo.removePage(
        database.pageId,
        database.lastUpdatedById ?? database.creatorId,
        workspaceId,
      );
    } else {
      await this.databaseRowRepo.archiveByDatabaseId(databaseId, workspaceId);
    }

    await this.databaseRepo.softDeleteDatabase(databaseId, workspaceId);
  }

  /**
   * Creates a property (column) in the database.
   */
  async createProperty(
    databaseId: string,
    dto: CreateDatabasePropertyDto,
    actorId: string,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);

    const currentProperties = await this.databasePropertyRepo.findByDatabaseId(
      databaseId,
    );

    const property = await this.databasePropertyRepo.insertProperty({
      databaseId,
      workspaceId,
      creatorId: actorId,
      name: dto.name,
      type: dto.type,
      settings: (dto.settings as never) ?? null,
      position: currentProperties.length,
    });

    const historyPageIds = await this.buildDatabaseHistoryTargetPageIds(
      database.id,
      workspaceId,
      database.spaceId,
      database.pageId ? [database.pageId] : [],
    );

    await this.recordDatabaseHistoryEvent({
      pageIds: historyPageIds,
      actorId,
      changeType: 'database.property.created',
      changeData: {
        databaseId: database.id,
        property: {
          id: property.id,
          name: property.name,
          type: this.normalizePropertyType(property.type),
        },
      },
    });

    return property;
  }

  /**
   * Returns a list of database properties.
   */
  async listProperties(databaseId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);
    const properties = await this.databasePropertyRepo.findByDatabaseId(databaseId);
    return this.normalizeProperties(properties);
  }

  /**
   * Updates a database property.
   */
  async updateProperty(
    databaseId: string,
    propertyId: string,
    dto: UpdateDatabasePropertyDto,
    workspaceId: string,
    actorId?: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);

    const property = await this.databasePropertyRepo.findById(propertyId);
    if (!property || property.databaseId !== databaseId) {
      throw new NotFoundException('Database property not found');
    }

    const updatedProperty = await this.databasePropertyRepo.updateProperty(propertyId, {
      ...dto,
      settings: dto.settings as never,
    });

    if (dto.type && dto.type !== property.type) {
      await this.convertPropertyCellValues(
        databaseId,
        propertyId,
        this.normalizePropertyType(property.type),
        dto.type,
        workspaceId,
        database.spaceId,
      );
    }

    const propertyChanges: Array<{
      field: 'name' | 'type' | 'settings';
      oldValue: unknown;
      newValue: unknown;
    }> = [];

    if (
      typeof dto.name === 'string' &&
      dto.name !== property.name
    ) {
      propertyChanges.push({
        field: 'name',
        oldValue: property.name,
        newValue: updatedProperty.name,
      });
    }

    if (dto.type && dto.type !== property.type) {
      propertyChanges.push({
        field: 'type',
        oldValue: this.normalizePropertyType(property.type),
        newValue: this.normalizePropertyType(updatedProperty.type),
      });
    }

    if (typeof dto.settings !== 'undefined') {
      propertyChanges.push({
        field: 'settings',
        oldValue: property.settings,
        newValue: updatedProperty.settings,
      });
    }

    const historyPageIds = await this.buildDatabaseHistoryTargetPageIds(
      database.id,
      workspaceId,
      database.spaceId,
      database.pageId ? [database.pageId] : [],
    );

    await this.recordDatabaseHistoryEvent({
      pageIds: historyPageIds,
      actorId: actorId ?? database.lastUpdatedById ?? database.creatorId,
      changeType: 'database.property.updated',
      changeData: {
        databaseId: database.id,
        property: {
          id: updatedProperty.id,
          name: updatedProperty.name,
          type: this.normalizePropertyType(updatedProperty.type),
        },
        changes: propertyChanges,
      },
    });

    return updatedProperty;
  }

  /**
   * Softly deletes a database property.
   */
  async deleteProperty(
    databaseId: string,
    propertyId: string,
    workspaceId: string,
    actorId?: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);

    const property = await this.databasePropertyRepo.findById(propertyId);
    if (!property || property.databaseId !== databaseId) {
      throw new NotFoundException('Database property not found');
    }

    await this.databasePropertyRepo.softDeleteProperty(propertyId);

    const historyPageIds = await this.buildDatabaseHistoryTargetPageIds(
      database.id,
      workspaceId,
      database.spaceId,
      database.pageId ? [database.pageId] : [],
    );

    await this.recordDatabaseHistoryEvent({
      pageIds: historyPageIds,
      actorId: actorId ?? database.lastUpdatedById ?? database.creatorId,
      changeType: 'database.property.deleted',
      changeData: {
        databaseId: database.id,
        property: {
          id: property.id,
          name: property.name,
          type: this.normalizePropertyType(property.type),
        },
      },
    });
  }

  /**
   * Creates a database row.
   */
  async createRow(
    databaseId: string,
    dto: CreateDatabaseRowDto,
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);

    /**
     * Calculate the parent of the new line:
     * - if the client explicitly passed parentPageId, use it;
     * - otherwise we bind the string to the database page as to the root node of the string tree.
     */
    const targetParentPageId = dto.parentPageId ?? database.pageId ?? null;

    if (!database.pageId) {
      throw new NotFoundException('Database root page not found');
    }

    /**
     * If the parent is specified, we check the basic accessibility of the page in the desired workspace/space.
     */
    if (targetParentPageId) {
      await this.assertCanAccessTargetPage(
        targetParentPageId,
        workspaceId,
        database.spaceId,
      );
    }

    /**
     * Additional database context protection:
     * We only allow line nesting in:
     * 1) the page of the database itself, or
     * 2) a page of an already existing (non-archived) line of the same database.
     */
    if (targetParentPageId && targetParentPageId !== database.pageId) {
      const parentRow = await this.databaseRowRepo.findByDatabaseAndPage(
        databaseId,
        targetParentPageId,
      );

      if (!parentRow || parentRow.archivedAt) {
        throw new NotFoundException('Parent row not found');
      }
    }

    /**
     * The base line is created as a regular page in the same tree.
     *
     * By default, we attach a string to the pageId of the base so that the structure remains
     * predictable and did not fall apart into “orphaned” root pages.
     */
    const page = await this.pageService.create(user.id, workspaceId, {
      title: dto.title,
      icon: dto.icon,
      parentPageId: targetParentPageId,
      spaceId: database.spaceId,
    });

    const createdRow = await this.databaseRowRepo.insertRow({
      databaseId,
      pageId: page.id,
      workspaceId,
      createdById: user.id,
      updatedById: user.id,
    });

    const historyPageIds = await this.buildDatabaseHistoryTargetPageIds(
      database.id,
      workspaceId,
      database.spaceId,
      database.pageId ? [database.pageId] : [],
    );

    await this.recordDatabaseHistoryEvent({
      pageIds: historyPageIds,
      actorId: user.id,
      changeType: 'database.row.created',
      changeData: {
        databaseId: database.id,
        rowContext: {
          rowPageId: page.id,
          parentPageId: targetParentPageId,
        },
        row: {
          pageId: page.id,
          title: page.title,
        },
      },
    });

    return {
      ...createdRow,
      slugId: page.slugId,
    };
  }

  /**
   * Returns all rows in the database.
   */
  async listRows(
    databaseId: string,
    user: User,
    workspaceId: string,
    query?: ListDatabaseRowsQueryDto,
  ): Promise<any[] | IListDatabaseRowsResponse<any>> {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanReadDatabasePages(user, database.spaceId);

    const properties = await this.databasePropertyRepo.findByDatabaseId(databaseId);
    const normalizedProperties = this.normalizeProperties(properties);
    const propertiesById = new Map(
      normalizedProperties.map((property) => [property.id, property]),
    );
    const rowsFilters = this.parseRowsFilters(query?.filters);
    const hasServerRowsState = rowsFilters.length > 0 || Boolean(query?.sortPropertyId);

    const userPropertyIds = new Set(
      normalizedProperties
        .filter((property) => property.type === 'user')
        .map((property) => property.id),
    );

    if (!query?.limit) {
      const rows = await this.databaseRowRepo.findByDatabaseId(
        databaseId,
        workspaceId,
        database.spaceId,
      );
      const normalizedRows = await this.enrichRowsWithUserNames(
        rows,
        userPropertyIds,
        workspaceId,
      );

      if (!hasServerRowsState) {
        return normalizedRows;
      }

      const pageTitleById = await this.resolvePageTitlesById(
        normalizedRows,
        propertiesById,
        workspaceId,
      );
      return this.applyRowsServerState({
        rows: normalizedRows,
        filters: rowsFilters,
        sortPropertyId: query?.sortPropertyId,
        sortDirection: query?.sortDirection,
        propertiesById,
        pageTitleById,
      });
    }

    const paginatedRows = await this.databaseRowRepo.findByDatabaseIdPaginated(
      databaseId,
      workspaceId,
      database.spaceId,
      {
        limit: query.limit,
        cursor: query.cursor,
        sortField: query.sortField,
        sortDirection: query.sortDirection,
        sortPropertyId: query.sortPropertyId,
        filters: rowsFilters,
      },
    );

    const normalizedRows = await this.enrichRowsWithUserNames(
      paginatedRows.items,
      userPropertyIds,
      workspaceId,
    );

    return {
      items: normalizedRows,
      nextCursor: paginatedRows.nextCursor,
      hasMore: paginatedRows.hasMore,
    };
  }

  /**
   * Renames a database row page and regenerates slug.
   */
  async updateRow(
    databaseId: string,
    pageId: string,
    dto: UpdateDatabaseRowDto,
    user: User,
    workspaceId: string,
  ): Promise<IUpdatedDatabaseRowResponse> {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);
    await this.assertCanAccessTargetPage(pageId, workspaceId, database.spaceId);

    const row = await this.databaseRowRepo.findByDatabaseAndPage(databaseId, pageId);
    if (!row || row.archivedAt) {
      throw new NotFoundException('Database row not found');
    }

    const rowPage = await this.pageRepo.findById(pageId);
    if (!rowPage || rowPage.workspaceId !== workspaceId || rowPage.deletedAt) {
      throw new NotFoundException('Database row page not found');
    }

    const nextTitle = dto.title.trim();
    if (!nextTitle) {
      throw new BadRequestException('Row title is required');
    }

    const previousTitle = rowPage.title ?? '';
    const previousSlugId = rowPage.slugId ?? '';

    if (nextTitle === previousTitle) {
      return {
        pageId: rowPage.id,
        title: previousTitle,
        slugId: previousSlugId,
      };
    }

    const nextSlugId = generateSlugId();
    await this.pageRepo.updatePage(
      {
        title: nextTitle,
        slugId: nextSlugId,
        lastUpdatedById: user.id,
        workspaceId,
      },
      pageId,
    );

    const updatedRowPage = await this.pageRepo.findById(pageId);
    if (!updatedRowPage || updatedRowPage.workspaceId !== workspaceId) {
      throw new NotFoundException('Database row page not found');
    }

    const historyPageIds = await this.buildDatabaseHistoryTargetPageIds(
      database.id,
      workspaceId,
      database.spaceId,
      database.pageId ? [database.pageId] : [],
    );

    await this.recordDatabaseHistoryEvent({
      pageIds: historyPageIds,
      actorId: user.id,
      changeType: 'database.row.renamed',
      changeData: {
        databaseId: database.id,
        rowContext: {
          rowPageId: pageId,
        },
        row: {
          pageId,
          title: updatedRowPage.title ?? '',
          slugId: updatedRowPage.slugId,
        },
        changes: [
          {
            field: 'title',
            oldValue: previousTitle,
            newValue: updatedRowPage.title ?? '',
          },
          {
            field: 'slugId',
            oldValue: previousSlugId,
            newValue: updatedRowPage.slugId,
          },
        ],
      },
    });

    return {
      pageId,
      title: updatedRowPage.title ?? '',
      slugId: updatedRowPage.slugId ?? nextSlugId,
    };
  }


  async deleteRow(
    databaseId: string,
    pageId: string,
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);

    await this.assertCanAccessTargetPage(pageId, workspaceId, database.spaceId);

    const row = await this.databaseRowRepo.findByDatabaseAndPage(databaseId, pageId);
    if (!row || row.archivedAt) {
      throw new NotFoundException('Database row not found');
    }

    const pages = await this.pageRepo.getPageAndDescendants(pageId, {
      includeContent: false,
    });

    const descendantPageIds = pages.map((page) => page.id);
    const historyPageIds = await this.buildDatabaseHistoryTargetPageIds(
      database.id,
      workspaceId,
      database.spaceId,
      [...descendantPageIds, ...(database.pageId ? [database.pageId] : [])],
    );

    for (const descendantPageId of descendantPageIds) {
      await this.databaseRowRepo.softDetachRowLink(
        databaseId,
        descendantPageId,
        workspaceId,
      );
    }

    await this.recordDatabaseHistoryEvent({
      pageIds: historyPageIds,
      actorId: user.id,
      changeType: 'database.row.deleted',
      changeData: {
        databaseId: database.id,
        rowContext: {
          rowPageId: pageId,
          descendantPageIds,
        },
      },
    });

    await this.pageRepo.removePage(pageId, user.id, workspaceId);
  }


  async getRowContextByPage(pageId: string, user: User, workspaceId: string) {
    const row = await this.databaseRowRepo.findActiveByPageId(pageId, workspaceId);

    if (!row) {
      return null;
    }

    const database = await this.getOrFailDatabase(row.databaseId, workspaceId);
    await this.assertCanReadDatabasePages(user, database.spaceId);

    const [properties, cells] = await Promise.all([
      this.databasePropertyRepo.findByDatabaseId(database.id),
      this.databaseCellRepo.findByDatabaseAndPage(database.id, pageId),
    ]);

    return { database, row, properties: this.normalizeProperties(properties), cells };
  }

  /**
   * Batch update of cells within a row (page is the row key).
   */
  async batchUpdateRowCells(
    databaseId: string,
    pageId: string,
    dto: BatchUpdateDatabaseCellsDto,
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);
    await this.assertCanAccessTargetPage(pageId, workspaceId, database.spaceId);

    const existingRow = await this.databaseRowRepo.findByDatabaseAndPage(
      databaseId,
      pageId,
    );

    const row =
      existingRow ??
      (await this.databaseRowRepo.insertRow({
        databaseId,
        pageId,
        workspaceId,
        createdById: user.id,
        updatedById: user.id,
      }));

    const [existingCells, properties] = await Promise.all([
      this.databaseCellRepo.findByDatabaseAndPage(databaseId, pageId),
      this.databasePropertyRepo.findByDatabaseId(databaseId),
    ]);

    const normalizedProperties = this.normalizeProperties(properties);

    const previousCellsByPropertyId = new Map(
      existingCells.map((existingCell) => [existingCell.propertyId, existingCell]),
    );
    const propertyById = new Map(
      normalizedProperties.map((property) => [property.id, property]),
    );

    const cells = [];
    const historyUserNameCache = new Map<string, string>();
    const historyPageReferenceCache = new Map<
      string,
      IDatabasePageReferenceCellValue
    >();
    const cellChanges: Array<{
      propertyId: string;
      propertyName: string;
      propertyType: DatabasePropertyType | null;
      operation: 'upsert' | 'delete';
      oldValue: unknown;
      newValue: unknown;
    }> = [];
    for (const cell of dto.cells) {
      const property = propertyById.get(cell.propertyId);
      const previousCell = previousCellsByPropertyId.get(cell.propertyId);
      const previousUserId =
        property?.type === 'user' ? this.extractUserIdFromCellValue(previousCell?.value) : null;
      const propertyType = property
        ? this.normalizePropertyType(property.type)
        : null;
      const previousValue = this.extractCurrentCellValue(previousCell?.value);
      const oldHistoryValue = await this.resolveHistoryCellValue({
        propertyType,
        propertySettings: property?.settings,
        value: previousCell?.value,
        workspaceId,
        userNameCache: historyUserNameCache,
        pageReferenceCache: historyPageReferenceCache,
      });

      if (cell.operation === 'delete') {
        const deleted = await this.databaseCellRepo.upsertCell({
          databaseId,
          pageId,
          propertyId: cell.propertyId,
          workspaceId,
          value: null,
          attachmentId: null,
          createdById: user.id,
          updatedById: user.id,
        });

        const softDeleted = await this.databaseCellRepo.updateCell(deleted.id, {
          deletedAt: new Date(),
          value: null,
          attachmentId: null,
          updatedById: user.id,
        });

        cells.push(softDeleted);
        cellChanges.push({
          propertyId: cell.propertyId,
          propertyName: property?.name ?? cell.propertyId,
          propertyType,
          operation: 'delete',
          oldValue: oldHistoryValue ?? null,
          newValue: null,
        });
        continue;
      }

      const normalizedValue = this.normalizeInputCellValue(cell.value);
      const upserted = await this.databaseCellRepo.upsertCell({
        databaseId,
        pageId,
        propertyId: cell.propertyId,
        workspaceId,
        value: normalizedValue as never,
        attachmentId: cell.attachmentId ?? null,
        createdById: user.id,
        updatedById: user.id,
      });

      if (property?.type === 'user') {
        const nextUserId = this.extractUserIdFromCellValue(normalizedValue);

        if (nextUserId && nextUserId !== previousUserId && nextUserId !== user.id) {
          await this.notifyDatabaseUserAssignment({
            actorId: user.id,
            pageId,
            spaceId: database.spaceId,
            workspaceId,
            recipientId: nextUserId,
          });
        }
      }

      previousCellsByPropertyId.set(cell.propertyId, upserted);
      cells.push(upserted);
      const newHistoryValue = await this.resolveHistoryCellValue({
        propertyType,
        propertySettings: property?.settings,
        value: upserted.value,
        workspaceId,
        userNameCache: historyUserNameCache,
        pageReferenceCache: historyPageReferenceCache,
      });
      cellChanges.push({
        propertyId: cell.propertyId,
        propertyName: property?.name ?? cell.propertyId,
        propertyType,
        operation: 'upsert',
        oldValue: oldHistoryValue ?? null,
        newValue: newHistoryValue ?? null,
      });
    }

    if (cellChanges.length > 0) {
      const historyPageIds = await this.buildDatabaseHistoryTargetPageIds(
        database.id,
        workspaceId,
        database.spaceId,
        database.pageId ? [database.pageId] : [],
      );

      await this.recordDatabaseHistoryEvent({
        pageIds: historyPageIds,
        actorId: user.id,
        changeType: 'database.row.cells.updated',
        changeData: {
          databaseId: database.id,
          rowContext: {
            rowPageId: pageId,
          },
          changes: cellChanges,
        },
      });
    }

    return { row, cells };
  }

  async batchUpdateRows(
    databaseId: string,
    dto: BatchUpdateDatabaseRowsDto,
    user: User,
    workspaceId: string,
  ): Promise<{
    updatedRows: string[];
    deletedRows: string[];
    failedRows: string[];
  }> {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);

    const updatedRows: string[] = [];
    const deletedRows: string[] = [];
    const failedRows: string[] = [];

    for (const rowOperation of dto.rows ?? []) {
      try {
        if (rowOperation.operation === 'delete_row') {
          await this.deleteRow(
            databaseId,
            rowOperation.pageId,
            user,
            workspaceId,
          );
          deletedRows.push(rowOperation.pageId);
          continue;
        }

        const cells = rowOperation.cells ?? [];
        if (cells.length === 0) {
          continue;
        }

        await this.batchUpdateRowCells(
          databaseId,
          rowOperation.pageId,
          { cells },
          user,
          workspaceId,
        );
        updatedRows.push(rowOperation.pageId);
      } catch {
        failedRows.push(rowOperation.pageId);
      }
    }

    return {
      updatedRows,
      deletedRows,
      failedRows,
    };
  }

  /**
   * Retrieves the user ID from the value of the user cell.
   */
  private extractUserIdFromCellValue(value: unknown): string | null {
    const currentValue = this.extractCurrentCellValue(value);

    if (typeof currentValue === 'string') {
      const normalizedValue = currentValue.trim();
      if (!normalizedValue) {
        return null;
      }

      try {
        const parsedValue = JSON.parse(normalizedValue);
        const parsedUserId = this.extractUserIdFromCellValue(parsedValue);
        if (parsedUserId) {
          return parsedUserId;
        }
      } catch {
        // Keep normalized string fallback below.
      }

      return normalizedValue;
    }

    if (!currentValue || typeof currentValue !== 'object' || !('id' in currentValue)) {
      return null;
    }

    const candidate = (currentValue as IDatabaseUserCellValue).id;
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
  }

  /**
   * Notifies the new executor when the user cell changes.
   */
  private async notifyDatabaseUserAssignment(params: {
    actorId: string;
    pageId: string;
    spaceId: string;
    workspaceId: string;
    recipientId: string;
  }): Promise<void> {
    await this.notificationQueue.add(QueueJob.PAGE_RECIPIENT_NOTIFICATION, {
      reason: 'database-user-assigned',
      actorId: params.actorId,
      pageId: params.pageId,
      spaceId: params.spaceId,
      workspaceId: params.workspaceId,
      candidateUserIds: [params.recipientId],
    } as IPageRecipientNotificationJob);
  }

  /**
   * On the first valid user input, clears the fallback value.
   */
  private normalizeInputCellValue(value: unknown): unknown {
    if (!this.isCellFallbackValue(value)) {
      return value ?? null;
    }

    return value.value ?? null;
  }

  /**
   * Creates a new database view.
   */
  async createView(
    databaseId: string,
    dto: CreateDatabaseViewDto,
    actorId: string,
    workspaceId: string,
  ) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    return this.databaseViewRepo.insertView({
      databaseId,
      workspaceId,
      creatorId: actorId,
      name: dto.name,
      type: dto.type,
      config: (dto.config as never) ?? null,
    });
  }

  /**
   * Returns a list of database views.
   */
  async listViews(databaseId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);
    return this.databaseViewRepo.findByDatabaseId(databaseId);
  }

  /**
   * Updates the database view.
   */
  async updateView(
    databaseId: string,
    viewId: string,
    dto: UpdateDatabaseViewDto,
    workspaceId: string,
  ) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const view = await this.databaseViewRepo.findById(viewId);
    if (!view || view.databaseId !== databaseId) {
      throw new NotFoundException('Database view not found');
    }

    return this.databaseViewRepo.updateView(viewId, {
      ...dto,
      config: dto.config as never,
    });
  }

  /**
   * Gently deletes a database view.
   */
  async deleteView(databaseId: string, viewId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const view = await this.databaseViewRepo.findById(viewId);
    if (!view || view.databaseId !== databaseId) {
      throw new NotFoundException('Database view not found');
    }

    await this.databaseViewRepo.softDeleteView(viewId);
  }

  /**
   * Converts the database back to a regular page.
   *
   * Transactionally mark the database entity as deleted (deactivated),
   * archive rows and clear table metadata.
   * The row pages themselves are not deleted and remain child nodes of the root-page.
   */
  async convertDatabaseToPage(
    databaseId: string,
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);

   const updatedAt = new Date();

    await executeTx(this.db, async (trx) => {
      await this.databaseRowRepo.archiveByDatabaseId(database.id, workspaceId, trx);
      await this.databaseViewRepo.softDeleteByDatabaseId(database.id, workspaceId, trx);

      await trx
        .updateTable('databaseProperties')
        .set({ deletedAt: updatedAt, updatedAt })
        .where('databaseId', '=', database.id)
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .execute();

      await this.databaseRepo.updateDatabase(
        database.id,
        workspaceId,
        {
          deletedAt: updatedAt,
          lastUpdatedById: user.id,
        },
        trx,
      );
    });

    if (database.pageId) {
      await this.pageHistoryRecorder.recordPageEvent({
        pageId: database.pageId,
        actorId: user.id,
        changeType: 'database.converted.to-page',
        changeData: {
          databaseId: database.id,
          conversion: {
            direction: 'database-to-page',
          },
        },
      });
    }

    if (database.pageId) {
      const page = await this.pageRepo.findById(database.pageId);
      if (page) {
        return page;
      }
    }

    return null;
  }
}

