import { Injectable } from '@nestjs/common';
import { PageHistoryRepo } from '@docmost/db/repos/page/page-history.repo';
import { PageHistory, User } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { CursorPaginationResult } from '@docmost/db/pagination/cursor-pagination';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { DatabasePropertyRepo } from '@docmost/db/repos/database/database-property.repo';
import { PageAccessService } from '../../page-access/page-access.service';

type HistoryEnrichmentCaches = {
  userCache: Map<string, Record<string, unknown>>;
  pageCache: Map<string, Record<string, unknown> | null>;
  selectCache: Map<string, Map<string, string>>;
};

type HistoryEnrichmentReferences = {
  userIds: Set<string>;
  pageIds: Set<string>;
  propertyIds: Set<string>;
};

@Injectable()
export class PageHistoryService {
  constructor(
    private pageHistoryRepo: PageHistoryRepo,
    private userRepo: UserRepo,
    private pageRepo: PageRepo,
    private databasePropertyRepo: DatabasePropertyRepo,
    private pageAccessService: PageAccessService,
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

  private createEnrichmentCaches(): HistoryEnrichmentCaches {
    return {
      userCache: new Map<string, Record<string, unknown>>(),
      pageCache: new Map<string, Record<string, unknown> | null>(),
      selectCache: new Map<string, Map<string, string>>(),
    };
  }

  private buildSelectOptionMap(settings: unknown): Map<string, string> {
    const optionMap = new Map<string, string>();
    const options = this.asArray(
      (settings as Record<string, unknown> | null)?.['options'],
    );
    for (const option of options) {
      if (!this.isRecord(option)) continue;
      const value = option.value;
      const label = option.label;
      if (
        typeof value === 'string' &&
        value.trim() &&
        typeof label === 'string' &&
        label.trim()
      ) {
        optionMap.set(value, label);
      }
    }
    return optionMap;
  }

  private collectEnrichmentReferences(
    changeType: string | null,
    changeData: unknown,
    references: HistoryEnrichmentReferences,
  ): void {
    if (!this.isRecord(changeData)) return;

    if (changeType === 'page.events.combined') {
      for (const event of this.asArray(changeData.events)) {
        if (!this.isRecord(event)) continue;
        this.collectEnrichmentReferences(
          typeof event.changeType === 'string' ? event.changeType : null,
          event.changeData,
          references,
        );
      }
      return;
    }

    if (changeType === 'page.custom-fields.updated') {
      for (const change of this.asArray(changeData.changes)) {
        if (!this.isRecord(change)) continue;
        if (change.field === 'assigneeId') {
          for (const value of [change.oldValue, change.newValue]) {
            const userId = this.extractUserId(value);
            if (userId) references.userIds.add(userId);
          }
        } else if (change.field === 'stakeholderIds') {
          for (const value of [
            ...this.asArray(change.oldValue),
            ...this.asArray(change.newValue),
          ]) {
            const userId = this.extractUserId(value);
            if (userId) references.userIds.add(userId);
          }
        }
      }
      return;
    }

    if (changeType !== 'database.row.cells.updated') return;
    for (const change of this.asArray(changeData.changes)) {
      if (!this.isRecord(change)) continue;
      const values = [change.oldValue, change.newValue];
      if (change.propertyType === 'user') {
        for (const value of values) {
          const userId = this.extractUserId(value);
          if (userId) references.userIds.add(userId);
        }
      } else if (change.propertyType === 'page_reference') {
        for (const value of values) {
          const pageId = this.extractPageId(value);
          if (pageId) references.pageIds.add(pageId);
        }
      } else if (
        change.propertyType === 'select' &&
        typeof change.propertyId === 'string'
      ) {
        references.propertyIds.add(change.propertyId);
      }
    }
  }

  private async preloadEnrichmentCaches(
    histories: PageHistory[],
    user?: User,
  ): Promise<HistoryEnrichmentCaches> {
    const caches = this.createEnrichmentCaches();
    const references: HistoryEnrichmentReferences = {
      userIds: new Set(),
      pageIds: new Set(),
      propertyIds: new Set(),
    };
    for (const history of histories) {
      this.collectEnrichmentReferences(
        history.changeType,
        history.changeData,
        references,
      );
    }

    const workspaceId = histories[0]?.workspaceId;
    if (!workspaceId) return caches;

    for (const userId of references.userIds) {
      caches.userCache.set(userId, {
        id: userId,
        name: userId,
        avatarUrl: null,
      });
    }
    for (const pageId of references.pageIds) {
      caches.pageCache.set(pageId, null);
    }
    for (const propertyId of references.propertyIds) {
      caches.selectCache.set(propertyId, new Map());
    }

    await Promise.all([
      (async () => {
        try {
          const users = await this.userRepo.findByIds(
            [...references.userIds],
            workspaceId,
          );
          for (const resolvedUser of users) {
            caches.userCache.set(resolvedUser.id, {
              id: resolvedUser.id,
              name: resolvedUser.name?.trim() || resolvedUser.id,
              avatarUrl: resolvedUser.avatarUrl ?? null,
            });
          }
        } catch {
          // Preserve identifier-only fallbacks for malformed legacy payloads.
        }
      })(),
      (async () => {
        if (!user || references.pageIds.size === 0) return;
        try {
          const pages = await this.pageRepo.findReferencesByIds(
            [...references.pageIds],
            workspaceId,
          );
          const accessByPageId =
            await this.pageAccessService.getEffectiveAccessForPages(
              pages,
              user,
            );
          for (const page of pages) {
            if (!accessByPageId.get(page.id)?.capabilities.canRead) continue;
            caches.pageCache.set(page.id, {
              id: page.id,
              title: page.title?.trim() || page.id,
              slugId: page.slugId ?? null,
            });
          }
        } catch {
          // Fail closed: unresolved page metadata remains null.
        }
      })(),
      (async () => {
        try {
          const properties = await this.databasePropertyRepo.findByIds(
            [...references.propertyIds],
            workspaceId,
          );
          for (const property of properties) {
            caches.selectCache.set(
              property.id,
              this.buildSelectOptionMap(property.settings),
            );
          }
        } catch {
          // Raw option values remain readable if metadata cannot be loaded.
        }
      })(),
    ]);
    return caches;
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

    let resolvedUser: { name?: string; avatarUrl?: string | null } | null =
      null;
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
    user: User | undefined,
    pageCache: Map<string, Record<string, unknown> | null>,
  ): Promise<Record<string, unknown> | null> {
    if (pageCache.has(pageId)) {
      return pageCache.get(pageId) ?? null;
    }

    if (!user) {
      pageCache.set(pageId, null);
      return null;
    }

    let pageRef: Record<string, unknown> | null = null;
    try {
      const page = await this.pageRepo.findById(pageId);
      const canUsePageMeta =
        !!page && page.workspaceId === workspaceId && page.deletedAt === null;

      if (canUsePageMeta) {
        const access = await this.pageAccessService.getEffectiveAccess(
          page,
          user,
        );
        if (access.capabilities.canRead) {
          pageRef = {
            id: pageId,
            title: page.title?.trim() || pageId,
            slugId: page.slugId ?? null,
          };
        }
      }
    } catch {
      pageRef = null;
    }

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

    const property = await this.databasePropertyRepo.findById(propertyId);
    const optionMap = this.buildSelectOptionMap(property?.settings);

    selectCache.set(propertyId, optionMap);
    return optionMap.get(optionValue) ?? optionValue;
  }

  private async enrichCellHistoryValue(params: {
    value: unknown;
    propertyType: string | null;
    propertyId: string | null;
    workspaceId: string;
    user?: User;
    userCache: Map<string, Record<string, unknown>>;
    pageCache: Map<string, Record<string, unknown> | null>;
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

      return this.resolveHistoryPageRef(
        pageId,
        workspaceId,
        params.user,
        params.pageCache,
      );
    }

    if (propertyType === 'select') {
      const optionValue = this.extractSelectValue(value);
      if (!optionValue) {
        return value;
      }

      const optionLabel = propertyId
        ? await this.resolveSelectLabel(
            propertyId,
            optionValue,
            params.selectCache,
          )
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
    user?: User;
    userCache: Map<string, Record<string, unknown>>;
    pageCache: Map<string, Record<string, unknown> | null>;
    selectCache: Map<string, Map<string, string>>;
  }): Promise<unknown> {
    const {
      changeType,
      changeData,
      workspaceId,
      userCache,
      pageCache,
      selectCache,
    } = params;
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
              user: params.user,
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
            typeof change.propertyType === 'string'
              ? change.propertyType
              : null;
          const propertyId =
            typeof change.propertyId === 'string' ? change.propertyId : null;

          return {
            ...change,
            oldValue: await this.enrichCellHistoryValue({
              value: change.oldValue,
              propertyType,
              propertyId,
              workspaceId,
              user: params.user,
              userCache,
              pageCache,
              selectCache,
            }),
            newValue: await this.enrichCellHistoryValue({
              value: change.newValue,
              propertyType,
              propertyId,
              workspaceId,
              user: params.user,
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

  private async enrichHistoryEntry(
    history: PageHistory,
    user?: User,
    caches: HistoryEnrichmentCaches = this.createEnrichmentCaches(),
  ): Promise<PageHistory> {
    if (!history || !history.changeType || !history.changeData) {
      return history;
    }

    return {
      ...history,
      changeData: (await this.enrichChangeData({
        changeType: history.changeType,
        changeData: history.changeData,
        workspaceId: history.workspaceId,
        user,
        userCache: caches.userCache,
        pageCache: caches.pageCache,
        selectCache: caches.selectCache,
      })) as never,
    };
  }

  async findById(
    historyId: string,
    user?: User,
  ): Promise<PageHistory | undefined> {
    const history = await this.pageHistoryRepo.findById(historyId, {
      includeContent: true,
    });

    if (!history) {
      return history;
    }

    const caches = await this.preloadEnrichmentCaches([history], user);
    return this.enrichHistoryEntry(history, user, caches);
  }

  async findMetadataById(
    historyId: string,
  ): Promise<Pick<PageHistory, 'id' | 'workspaceId'> | undefined> {
    return this.pageHistoryRepo.findMetadataById(historyId);
  }

  async deleteById(historyId: string): Promise<void> {
    await this.pageHistoryRepo.deleteById(historyId);
  }

  async findHistoryByPageId(
    pageId: string,
    paginationOptions: PaginationOptions,
    user?: User,
  ): Promise<CursorPaginationResult<PageHistory>> {
    const result = await this.pageHistoryRepo.findPageHistoryByPageId(
      pageId,
      paginationOptions,
    );

    const caches = await this.preloadEnrichmentCaches(result.items, user);
    const enrichedItems = await Promise.all(
      result.items.map((history) =>
        this.enrichHistoryEntry(history, user, caches),
      ),
    );

    return {
      ...result,
      items: enrichedItems,
    };
  }
}
