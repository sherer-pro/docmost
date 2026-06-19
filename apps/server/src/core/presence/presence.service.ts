import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PageAccessService } from '../page-access/page-access.service';
import {
  MemberPresence,
  MemberPresenceSession,
  PresenceConnectionContext,
  PresenceLocation,
  PresenceLocationType,
  PresenceUpdateInput,
  StoredPresenceConnection,
  WorkspaceMembersPresenceResponse,
} from './presence.types';

const CONNECTION_TTL_MS = 45_000;
const USER_CONNECTION_SET_TTL_MS = CONNECTION_TTL_MS * 2;
const MAX_LOCATION_TITLE_LENGTH = 160;

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly redis: Redis;

  constructor(
    private readonly redisService: RedisService,
    private readonly pageRepo: PageRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pageAccessService: PageAccessService,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  async updateConnection(
    context: PresenceConnectionContext,
    input: PresenceUpdateInput,
  ): Promise<void> {
    const location = await this.resolveLocation(context, input);
    if (!location) {
      return;
    }

    const now = new Date().toISOString();
    const record: StoredPresenceConnection = {
      socketId: context.socketId,
      userId: context.user.id,
      workspaceId: context.user.workspaceId,
      sessionId: context.sessionId ?? null,
      tabId: this.normalizeValue(input.tabId),
      deviceName: context.deviceName ?? null,
      location,
      lastSeenAt: now,
    };

    const connectionKey = this.getConnectionKey(context.socketId);
    const userConnectionsKey = this.getUserConnectionsKey(
      record.workspaceId,
      record.userId,
    );

    await this.redis
      .multi()
      .set(connectionKey, JSON.stringify(record), 'PX', CONNECTION_TTL_MS)
      .sadd(userConnectionsKey, context.socketId)
      .pexpire(userConnectionsKey, USER_CONNECTION_SET_TTL_MS)
      .exec();
  }

  async removeConnection(socketId: string): Promise<void> {
    const key = this.getConnectionKey(socketId);
    const raw = await this.redis.get(key);

    if (!raw) {
      await this.redis.del(key);
      return;
    }

    const record = this.parseRecord(raw);
    if (!record) {
      await this.redis.del(key);
      return;
    }

    await this.redis
      .multi()
      .del(key)
      .srem(this.getUserConnectionsKey(record.workspaceId, record.userId), socketId)
      .exec();
  }

  async getWorkspaceMembersPresence(
    workspaceId: string,
    userIds: string[],
  ): Promise<WorkspaceMembersPresenceResponse> {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    const users: Record<string, MemberPresence> = {};

    for (const userId of uniqueUserIds) {
      users[userId] = await this.getMemberPresence(workspaceId, userId);
    }

    return { users };
  }

  private async getMemberPresence(
    workspaceId: string,
    userId: string,
  ): Promise<MemberPresence> {
    const userConnectionsKey = this.getUserConnectionsKey(workspaceId, userId);
    const socketIds = await this.redis.smembers(userConnectionsKey);

    if (socketIds.length === 0) {
      return this.emptyPresence();
    }

    const records: StoredPresenceConnection[] = [];
    const staleSocketIds: string[] = [];

    for (const socketId of socketIds) {
      const raw = await this.redis.get(this.getConnectionKey(socketId));
      if (!raw) {
        staleSocketIds.push(socketId);
        continue;
      }

      const record = this.parseRecord(raw);
      if (
        !record ||
        record.workspaceId !== workspaceId ||
        record.userId !== userId
      ) {
        staleSocketIds.push(socketId);
        continue;
      }

      records.push(record);
    }

    if (staleSocketIds.length > 0) {
      await this.redis.srem(userConnectionsKey, ...staleSocketIds);
    }

    if (records.length === 0) {
      return this.emptyPresence();
    }

    const sessionsByKey = new Map<
      string,
      MemberPresenceSession & { locationKeys: Set<string> }
    >();
    let lastSeenAt: string | null = null;

    for (const record of records) {
      if (!lastSeenAt || record.lastSeenAt > lastSeenAt) {
        lastSeenAt = record.lastSeenAt;
      }

      const sessionKey = record.sessionId ?? `legacy:${record.socketId}`;
      let session = sessionsByKey.get(sessionKey);

      if (!session) {
        session = {
          sessionKey,
          sessionId: record.sessionId,
          isLegacy: !record.sessionId,
          deviceName: record.deviceName,
          lastSeenAt: record.lastSeenAt,
          locations: [],
          locationKeys: new Set<string>(),
        };
        sessionsByKey.set(sessionKey, session);
      }

      if (record.lastSeenAt > session.lastSeenAt) {
        session.lastSeenAt = record.lastSeenAt;
      }

      if (!session.deviceName && record.deviceName) {
        session.deviceName = record.deviceName;
      }

      const locationKey = this.getLocationKey(record.location);
      if (!session.locationKeys.has(locationKey)) {
        session.locationKeys.add(locationKey);
        session.locations.push(record.location);
      }
    }

    const sessions = [...sessionsByKey.values()]
      .map(({ locationKeys, ...session }) => ({
        ...session,
        locations: session.locations.sort((a, b) =>
          this.getLocationSortValue(a).localeCompare(this.getLocationSortValue(b)),
        ),
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

    return {
      isOnline: true,
      lastSeenAt,
      sessions,
    };
  }

  private async resolveLocation(
    context: PresenceConnectionContext,
    input: PresenceUpdateInput,
  ): Promise<PresenceLocation | null> {
    const requestedType = input.type ?? this.inferLocationType(input);
    const path = this.normalizePath(input.path);

    if (requestedType === 'page' && input.pageId) {
      return this.resolvePageLocation(context, input.pageId, path);
    }

    if (requestedType === 'space' && input.spaceId) {
      return this.resolveSpaceLocation(context, input.spaceId, path);
    }

    if (requestedType === 'workspace') {
      return {
        type: 'workspace',
        title: this.getWorkspaceLocationTitle(path),
        path,
      };
    }

    return null;
  }

  private async resolvePageLocation(
    context: PresenceConnectionContext,
    pageId: string,
    path: string | null,
  ): Promise<PresenceLocation | null> {
    try {
      const page = await this.pageRepo.findById(pageId, { includeSpace: true });
      if (
        !page ||
        page.deletedAt ||
        page.workspaceId !== context.user.workspaceId
      ) {
        return null;
      }

      const access = await this.pageAccessService.getEffectiveAccess(
        page,
        context.user,
      );
      if (!access.capabilities.canRead) {
        return null;
      }

      const pageWithSpace = page as typeof page & {
        space?: { name?: string | null; slug?: string | null };
      };
      const space = pageWithSpace.space as
        | { name?: string | null; slug?: string | null }
        | undefined;

      return {
        type: 'page',
        pageId: page.id,
        spaceId: page.spaceId,
        title: this.normalizeTitle(page.title, 'Untitled'),
        path,
        spaceName: space?.name ?? null,
        spaceSlug: space?.slug ?? null,
      };
    } catch (err) {
      this.logger.warn(`Failed to resolve presence page location: ${err}`);
      return null;
    }
  }

  private async resolveSpaceLocation(
    context: PresenceConnectionContext,
    spaceId: string,
    path: string | null,
  ): Promise<PresenceLocation | null> {
    try {
      const space = await this.spaceRepo.findById(spaceId, context.user.workspaceId);
      if (!space || space.deletedAt) {
        return null;
      }

      if (!this.pageAccessService.isWorkspaceBypassUser(context.user)) {
        const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(
          context.user.id,
        );
        if (!userSpaceIds.includes(space.id)) {
          return null;
        }
      }

      return {
        type: 'space',
        spaceId: space.id,
        title: this.normalizeTitle(space.name, 'Untitled space'),
        path,
        spaceName: space.name,
        spaceSlug: space.slug,
      };
    } catch (err) {
      this.logger.warn(`Failed to resolve presence space location: ${err}`);
      return null;
    }
  }

  private inferLocationType(input: PresenceUpdateInput): PresenceLocationType {
    if (input.pageId) {
      return 'page';
    }

    if (input.spaceId) {
      return 'space';
    }

    return 'workspace';
  }

  private normalizePath(path?: string): string | null {
    if (!path || !path.startsWith('/')) {
      return null;
    }

    return path.slice(0, 512);
  }

  private normalizeValue(value?: string): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed.slice(0, 120) : null;
  }

  private normalizeTitle(value: string | null | undefined, fallback: string): string {
    const title = value?.trim() || fallback;
    return title.slice(0, MAX_LOCATION_TITLE_LENGTH);
  }

  private getWorkspaceLocationTitle(path: string | null): string {
    if (!path || path === '/') {
      return 'Workspace';
    }

    if (path === '/home') {
      return 'Home';
    }

    if (path.startsWith('/settings')) {
      return 'Settings';
    }

    if (path.startsWith('/spaces')) {
      return 'Spaces';
    }

    return 'Workspace';
  }

  private getLocationKey(location: PresenceLocation): string {
    return [
      location.type,
      location.pageId ?? '',
      location.spaceId ?? '',
      location.path ?? '',
    ].join(':');
  }

  private getLocationSortValue(location: PresenceLocation): string {
    return `${location.type}:${location.title}:${location.path ?? ''}`;
  }

  private parseRecord(raw: string): StoredPresenceConnection | null {
    try {
      const parsed = JSON.parse(raw) as StoredPresenceConnection;
      if (!parsed.socketId || !parsed.userId || !parsed.workspaceId) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private emptyPresence(): MemberPresence {
    return {
      isOnline: false,
      lastSeenAt: null,
      sessions: [],
    };
  }

  private getConnectionKey(socketId: string): string {
    return `presence:connection:${socketId}`;
  }

  private getUserConnectionsKey(workspaceId: string, userId: string): string {
    return `presence:workspace:${workspaceId}:user:${userId}:connections`;
  }
}
