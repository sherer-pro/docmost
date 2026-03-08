import { Injectable } from '@nestjs/common';
import { PageHistoryRepo } from '@docmost/db/repos/page/page-history.repo';
import { PageHistory } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { CursorPaginationResult } from '@docmost/db/pagination/cursor-pagination';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { DatabasePropertyRepo } from '@docmost/db/repos/database/database-property.repo';

@Injectable()
export class PageHistoryService {
  constructor(
    private pageHistoryRepo: PageHistoryRepo,
    private userRepo: UserRepo,
    private pageRepo: PageRepo,
    private databasePropertyRepo: DatabasePropertyRepo,
  ) {}

  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private parseJsonString(value: string): unknown {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return value;
    }

    try {
      return JSON.parse(normalizedValue);
    } catch {
      return value;
    }
  }

  private extractUserId(value: unknown): string | null {
    if (typeof value === 'string') {
      const parsedValue = this.parseJsonString(value);
      if (parsedValue !== value) {
        return this.extractUserId(parsedValue);
      }

      return value.trim() || null;
    }

    if (!this.isRecord(value)) {
      return null;
    }

    const candidateId = value.id;
    return typeof candidateId === 'string' && candidateId.trim()
      ? candidateId.trim()
      : null;
  }

  private extractPageId(value: unknown): string | null {
    if (typeof value === 'string') {
      const parsedValue = this.parseJsonString(value);
      if (parsedValue !== value) {
        return this.extractPageId(parsedValue);
      }

      return value.trim() || null;
    }

    if (!this.isRecord(value)) {
      return null;
    }

    const candidateId =
      typeof value.id === 'string'
        ? value.id
        : typeof value.pageId === 'string'
          ? value.pageId
          : null;

    return candidateId?.trim() || null;
  }

  private extractSelectValue(value: unknown): string | null {
    if (typeof value === 'string') {
      const parsedValue = this.parseJsonString(value);
      if (parsedValue !== value) {
        return this.extractSelectValue(parsedValue);
      }

      return value.trim() || null;
    }

    if (!this.isRecord(value)) {
      return null;
    }

    const candidateValue =
      typeof value.value === 'string'
        ? value.value
        : typeof value.label === 'string'
          ? value.label
          : null;

    return candidateValue?.trim() || null;
  }

  private async resolveHistoryUserRef(
    userId: string,
    workspaceId: string,
    userCache: Map<string, Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const cachedUser = userCache.get(userId);
    if (cachedUser) {
      return cachedUser;
    }

    let resolvedUser: { name?: string; avatarUrl?: string | null } | null = null;
    try {
      resolvedUser = await this.userRepo.findById(userId, workspaceId);
    } catch {
      resolvedUser = null;
    }

    const userRef: Record<string, unknown> = {
      id: userId,
      name: resolvedUser?.name?.trim() || userId,
      avatarUrl: resolvedUser?.avatarUrl ?? null,
    };

    userCache.set(userId, userRef);
    return userRef;
  }

  private async resolveHistoryPageRef(
    pageId: string,
    workspaceId: string,
    pageCache: Map<string, Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const cachedPage = pageCache.get(pageId);
    if (cachedPage) {
      return cachedPage;
    }

    const page = await this.pageRepo.findById(pageId);
    const canUsePageMeta =
      !!page && page.workspaceId === workspaceId && page.deletedAt === null;
    const pageRef: Record<string, unknown> = {
      id: pageId,
      title: canUsePageMeta ? page.title?.trim() || pageId : pageId,
      slugId: canUsePageMeta ? page.slugId ?? null : null,
    };

    pageCache.set(pageId, pageRef);
    return pageRef;
  }

  private async resolveSelectLabel(
    propertyId: string,
    optionValue: string,
    selectCache: Map<string, Map<string, string>>,
  ): Promise<string> {
    const cachedOptions = selectCache.get(propertyId);
    if (cachedOptions) {
      return cachedOptions.get(optionValue) ?? optionValue;
    }

    const optionMap = new Map<string, string>();
    const property = await this.databasePropertyRepo.findById(propertyId);
    const options = this.asArray(
      (property?.settings as Record<string, unknown> | null)?.['options'],
    );

    for (const option of options) {
      if (!this.isRecord(option)) {
        continue;
      }

      const optionRawValue = option.value;
      const optionRawLabel = option.label;
      if (
        typeof optionRawValue !== 'string' ||
        !optionRawValue.trim() ||
        typeof optionRawLabel !== 'string' ||
        !optionRawLabel.trim()
      ) {
        continue;
      }

      optionMap.set(optionRawValue, optionRawLabel);
    }

    selectCache.set(propertyId, optionMap);
    return optionMap.get(optionValue) ?? optionValue;
  }

  private async enrichCellHistoryValue(params: {
    value: unknown;
    propertyType: string | null;
    propertyId: string | null;
    workspaceId: string;
    userCache: Map<string, Record<string, unknown>>;
    pageCache: Map<string, Record<string, unknown>>;
    selectCache: Map<string, Map<string, string>>;
  }): Promise<unknown> {
    const { value, propertyType, propertyId, workspaceId } = params;
    if (value === null || typeof value === 'undefined') {
      return value;
    }

    if (propertyType === 'user') {
      const userId = this.extractUserId(value);
      if (!userId) {
        return value;
      }

      return this.resolveHistoryUserRef(userId, workspaceId, params.userCache);
    }

    if (propertyType === 'page_reference') {
      const pageId = this.extractPageId(value);
      if (!pageId) {
        return value;
      }

      return this.resolveHistoryPageRef(pageId, workspaceId, params.pageCache);
    }

    if (propertyType === 'select') {
      const optionValue = this.extractSelectValue(value);
      if (!optionValue) {
        return value;
      }

      const optionLabel = propertyId
        ? await this.resolveSelectLabel(propertyId, optionValue, params.selectCache)
        : optionValue;

      return {
        value: optionValue,
        label: optionLabel,
      };
    }

    return value;
  }

  private async enrichCustomFieldChange(params: {
    change: unknown;
    workspaceId: string;
    userCache: Map<string, Record<string, unknown>>;
  }): Promise<unknown> {
    const { change, workspaceId, userCache } = params;
    if (!this.isRecord(change) || typeof change.field !== 'string') {
      return change;
    }

    if (change.field === 'assigneeId') {
      const oldUserId = this.extractUserId(change.oldValue);
      const newUserId = this.extractUserId(change.newValue);

      return {
        ...change,
        oldValue: oldUserId
          ? await this.resolveHistoryUserRef(oldUserId, workspaceId, userCache)
          : null,
        newValue: newUserId
          ? await this.resolveHistoryUserRef(newUserId, workspaceId, userCache)
          : null,
      };
    }

    if (change.field === 'stakeholderIds') {
      const oldUserIds = this.asArray(change.oldValue)
        .map((value) => this.extractUserId(value))
        .filter((value): value is string => Boolean(value));
      const newUserIds = this.asArray(change.newValue)
        .map((value) => this.extractUserId(value))
        .filter((value): value is string => Boolean(value));

      const oldStakeholders = await Promise.all(
        oldUserIds.map((userId) =>
          this.resolveHistoryUserRef(userId, workspaceId, userCache),
        ),
      );
      const newStakeholders = await Promise.all(
        newUserIds.map((userId) =>
          this.resolveHistoryUserRef(userId, workspaceId, userCache),
        ),
      );

      return {
        ...change,
        oldValue: oldStakeholders,
        newValue: newStakeholders,
      };
    }

    return change;
  }

  private async enrichChangeData(params: {
    changeType: string | null;
    changeData: unknown;
    workspaceId: string;
    userCache: Map<string, Record<string, unknown>>;
    pageCache: Map<string, Record<string, unknown>>;
    selectCache: Map<string, Map<string, string>>;
  }): Promise<unknown> {
    const { changeType, changeData, workspaceId, userCache, pageCache, selectCache } = params;
    if (!this.isRecord(changeData)) {
      return changeData;
    }

    if (changeType === 'page.events.combined') {
      const events = this.asArray(changeData.events);
      const enrichedEvents = await Promise.all(
        events.map(async (event) => {
          if (!this.isRecord(event)) {
            return event;
          }

          const eventChangeType =
            typeof event.changeType === 'string' ? event.changeType : null;

          return {
            ...event,
            changeData: await this.enrichChangeData({
              changeType: eventChangeType,
              changeData: event.changeData,
              workspaceId,
              userCache,
              pageCache,
              selectCache,
            }),
          };
        }),
      );

      return {
        ...changeData,
        events: enrichedEvents,
      };
    }

    if (changeType === 'page.custom-fields.updated') {
      const changes = this.asArray(changeData.changes);
      const enrichedChanges = await Promise.all(
        changes.map((change) =>
          this.enrichCustomFieldChange({ change, workspaceId, userCache }),
        ),
      );

      return {
        ...changeData,
        changes: enrichedChanges,
      };
    }

    if (changeType === 'database.row.cells.updated') {
      const changes = this.asArray(changeData.changes);
      const enrichedChanges = await Promise.all(
        changes.map(async (change) => {
          if (!this.isRecord(change)) {
            return change;
          }

          const propertyType =
            typeof change.propertyType === 'string' ? change.propertyType : null;
          const propertyId =
            typeof change.propertyId === 'string' ? change.propertyId : null;

          return {
            ...change,
            oldValue: await this.enrichCellHistoryValue({
              value: change.oldValue,
              propertyType,
              propertyId,
              workspaceId,
              userCache,
              pageCache,
              selectCache,
            }),
            newValue: await this.enrichCellHistoryValue({
              value: change.newValue,
              propertyType,
              propertyId,
              workspaceId,
              userCache,
              pageCache,
              selectCache,
            }),
          };
        }),
      );

      return {
        ...changeData,
        changes: enrichedChanges,
      };
    }

    return changeData;
  }

  private async enrichHistoryEntry(history: PageHistory): Promise<PageHistory> {
    if (!history || !history.changeType || !history.changeData) {
      return history;
    }

    const userCache = new Map<string, Record<string, unknown>>();
    const pageCache = new Map<string, Record<string, unknown>>();
    const selectCache = new Map<string, Map<string, string>>();

    return {
      ...history,
      changeData: (await this.enrichChangeData({
        changeType: history.changeType,
        changeData: history.changeData,
        workspaceId: history.workspaceId,
        userCache,
        pageCache,
        selectCache,
      })) as never,
    };
  }

  async findById(historyId: string): Promise<PageHistory | undefined> {
    const history = await this.pageHistoryRepo.findById(historyId, {
      includeContent: true,
    });

    if (!history) {
      return history;
    }

    return this.enrichHistoryEntry(history);
  }

  async findHistoryByPageId(
    pageId: string,
    paginationOptions: PaginationOptions,
  ): Promise<CursorPaginationResult<PageHistory>> {
    const result = await this.pageHistoryRepo.findPageHistoryByPageId(
      pageId,
      paginationOptions,
    );

    const enrichedItems = await Promise.all(
      result.items.map((history) => this.enrichHistoryEntry(history)),
    );

    return {
      ...result,
      items: enrichedItems,
    };
  }
}
