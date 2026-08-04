import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TokenService } from '../core/auth/services/token.service';
import { JwtPayload, JwtType } from '../core/auth/dto/jwt-payload';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import * as cookie from 'cookie';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { WS_RELAY_EVENT_OPERATIONS, WsMessageDto } from './dto/ws-message.dto';
import { createCorsOriginValidator } from '../common/security/cors.util';
import { PageAccessService } from '../core/page-access/page-access.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { User } from '@docmost/db/types/entity.types';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { PresenceService } from '../core/presence/presence.service';
import { PresenceUpdateDto } from '../core/presence/dto/presence-update.dto';
import { SpacePolicyService } from '../core/space-policy/space-policy.service';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { OnEvent } from '@nestjs/event-emitter';
import { EventName } from '../common/events/event.contants';
import { PageTransclusionReferencesRepo } from '@docmost/db/repos/page-transclusions/page-transclusion-references.repo';

const wsCorsOriginValidator = createCorsOriginValidator();

@WebSocketGateway({
  cors: { origin: wsCorsOriginValidator, credentials: true },
  transports: ['websocket'],
})
export class WsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(WsGateway.name);

  @WebSocketServer()
  server: Server;
  constructor(
    private tokenService: TokenService,
    private spaceMemberRepo: SpaceMemberRepo,
    private readonly userRepo: UserRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly userSessionRepo: UserSessionRepo,
    private readonly presenceService: PresenceService,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly spacePolicy: SpacePolicyService,
    private readonly pageTransclusionReferencesRepo: PageTransclusionReferencesRepo,
  ) {}

  @OnEvent(EventName.PAGE_UPDATED)
  async handlePageEmbedSourceUpdated(event: {
    pageIds: string[];
    workspaceId: string;
  }): Promise<void> {
    try {
      const spaceIds = new Set<string>();
      for (const sourcePageId of event.pageIds) {
        const usages =
          await this.pageTransclusionReferencesRepo.findPageUsagesBySource(
            sourcePageId,
            event.workspaceId,
          );
        for (const consumerPageId of new Set(
          usages.map((usage) => usage.referencePageId),
        )) {
          const consumer = await this.pageRepo.findById(consumerPageId);
          if (consumer && !consumer.deletedAt) spaceIds.add(consumer.spaceId);
        }
      }
      this.emitPageEmbedInvalidation(spaceIds);
    } catch (error) {
      this.logger.warn('Failed to invalidate page embed consumers', error);
    }
  }

  @OnEvent(EventName.AUTHORIZATION_CHANGED)
  async handleAuthorizationChanged(event: {
    workspaceId: string;
    userId?: string;
    sessionId?: string;
  }): Promise<void> {
    if (!this.server) return;

    for (const socket of this.server.sockets.sockets.values()) {
      if (
        socket.data.workspaceId !== event.workspaceId ||
        (event.userId && socket.data.userId !== event.userId) ||
        (event.sessionId && socket.data.sessionId !== event.sessionId)
      ) {
        continue;
      }

      let authorized = false;
      try {
        authorized = await this.refreshClientAuthorization(socket);
      } catch (error) {
        this.logger.warn(
          `Failed to refresh authorization for socket ${socket.id}`,
          error,
        );
      }
      if (!authorized) {
        this.disconnectUnauthorized(socket);
      }
    }
  }

  @OnEvent(EventName.PAGE_SOFT_DELETED)
  async handlePageEmbedSourceTrashed(event: {
    pageIds: string[];
    workspaceId: string;
  }): Promise<void> {
    await this.handlePageEmbedSourceUpdated(event);
  }

  @OnEvent(EventName.PAGE_RESTORED)
  async handlePageEmbedSourceRestored(event: {
    pageIds: string[];
    workspaceId: string;
  }): Promise<void> {
    await this.handlePageEmbedSourceUpdated(event);
  }

  @OnEvent(EventName.PAGE_DELETED)
  async handlePageEmbedSourceDeleted(event: {
    pageIds: string[];
    workspaceId: string;
  }): Promise<void> {
    await this.handlePageEmbedSourceUpdated(event);
  }

  @OnEvent(EventName.PAGE_EMBED_VISIBILITY_CHANGED)
  handlePageEmbedVisibilityChanged(event: { workspaceId: string }): void {
    if (!this.server) return;
    for (const socket of this.server.sockets.sockets.values()) {
      const user = socket.data.user as User | undefined;
      if (user?.workspaceId === event.workspaceId) {
        socket.emit('page-embed:invalidate', {
          operation: 'page_embed_invalidate',
        });
      }
    }
  }

  /**
   * Authenticates a newly connected socket and joins it to all authorized rooms.
   *
   * The authorized room list is also cached on `client.data` and used later to
   * hard-enforce relay permissions in `handleMessage`.
   */
  async handleConnection(client: Socket, ...args: any[]): Promise<void> {
    try {
      const cookies = cookie.parse(client.handshake.headers.cookie);
      const token: JwtPayload = await this.tokenService.verifyJwt(
        cookies['authToken'],
        JwtType.ACCESS,
      );

      const userId = token.sub;
      const workspaceId = token.workspaceId;

      // A token without `sessionId` bypasses every revocation control, so it is
      // not accepted here either.
      if (!token.sessionId) {
        throw new Error('Unauthorized');
      }

      client.data.userId = userId;
      client.data.workspaceId = workspaceId;
      client.data.sessionId = token.sessionId;

      if (!(await this.refreshClientAuthorization(client))) {
        throw new Error('Unauthorized');
      }
    } catch (err) {
      this.disconnectUnauthorized(client);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    await this.presenceService.removeConnection(client.id);
  }

  /**
   * Validates and relays a message to exactly one authorized room.
   *
   * The method enforces DTO validation, room authorization, payload consistency,
   * and real Socket.IO room membership before rebroadcasting.
   */
  @SubscribeMessage('message')
  async handleMessage(client: Socket, data: any): Promise<void> {
    const payload = plainToInstance(WsMessageDto, data);
    const validationErrors = validateSync(payload, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (validationErrors.length > 0) {
      this.logger.warn(
        `Invalid WS payload from client ${client.id}: ${JSON.stringify(validationErrors)}`,
      );
      return;
    }

    if (!(await this.refreshClientAuthorization(client))) {
      this.disconnectUnauthorized(client);
      return;
    }

    const authorizedRooms: Set<string> = client.data.authorizedRooms ?? new Set();

    if (!this.isPayloadConsistent(payload)) {
      this.logger.warn(
        `Invalid targetRoom/spaceId/workspaceId combination from client ${client.id}`,
      );
      return;
    }

    if (!this.isRelayDataOperationAllowed(payload.data)) {
      this.logger.warn(
        `Invalid WS relay operation from client ${client.id}: ${String(payload.data?.operation)}`,
      );
      return;
    }

    /**
     * Block global broadcast by default.
     * Relay is allowed only to an explicit room granted on connect.
     */
    if (!authorizedRooms.has(payload.targetRoom)) {
      this.logger.warn(
        `Client ${client.id} tried to relay an event to unauthorized room ${payload.targetRoom}`,
      );
      return;
    }

    /**
     * Extra room-membership validation at Socket.IO level.
     * Even when a room is authorized, the socket must actually be joined to it.
     */
    if (!client.rooms.has(payload.targetRoom)) {
      this.logger.warn(
        `Client ${client.id} is not in room ${payload.targetRoom}; relay rejected`,
      );
      return;
    }

    if (payload.targetRoom.startsWith('space-')) {
      const pageId = this.extractPageId(payload.data);

      if (pageId) {
        const page = await this.pageRepo.findById(pageId);
        const sender = client.data.user as User | undefined;
        if (
          !page ||
          page.deletedAt ||
          page.spaceId !== payload.spaceId ||
          page.workspaceId !== sender?.workspaceId
        ) {
          return;
        }

        const room = this.server.sockets.adapter.rooms.get(payload.targetRoom);
        if (!room || room.size === 0) {
          return;
        }

        for (const socketId of room) {
          if (socketId === client.id) {
            continue;
          }

          const socket = this.server.sockets.sockets.get(socketId);
          if (!socket) {
            continue;
          }

          if (!(await this.refreshClientAuthorization(socket))) {
            this.disconnectUnauthorized(socket);
            continue;
          }

          const socketRooms: Set<string> =
            socket.data.authorizedRooms ?? new Set();
          if (!socketRooms.has(payload.targetRoom)) {
            continue;
          }

          const socketUser = socket.data.user as User | undefined;
          if (!socketUser) {
            continue;
          }

          const access = await this.pageAccessService.getEffectiveAccess(
            page,
            socketUser,
          );
          if (!access.capabilities.canRead) {
            continue;
          }

          socket.emit('message', payload);
        }

        return;
      }
    }

    const room =
      this.server.sockets.adapter.rooms.get(payload.targetRoom) ?? new Set();

    for (const socketId of [...room]) {
      if (socketId === client.id) {
        continue;
      }
      const socket = this.server.sockets.sockets.get(socketId);
      if (!socket) {
        continue;
      }
      if (!(await this.refreshClientAuthorization(socket))) {
        this.disconnectUnauthorized(socket);
        continue;
      }
    }

    client.broadcast.to(payload.targetRoom).emit('message', payload);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(client: Socket, @MessageBody() roomName: string): void {
    // if room is a space, check if user has permissions
    //client.join(roomName);
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(client: Socket, @MessageBody() roomName: string): void {
    client.leave(roomName);
  }

  @SubscribeMessage('presence:update')
  async handlePresenceUpdate(client: Socket, data: unknown): Promise<void> {
    const payload = plainToInstance(PresenceUpdateDto, data);
    const validationErrors = validateSync(payload, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (validationErrors.length > 0) {
      this.logger.warn(
        `Invalid presence payload from client ${client.id}: ${JSON.stringify(validationErrors)}`,
      );
      return;
    }

    if (!(await this.refreshClientAuthorization(client))) {
      this.disconnectUnauthorized(client);
      return;
    }

    const user = client.data.user as User | undefined;
    if (!user) {
      return;
    }

    if (client.data.workspaceAssuranceSatisfied === false) {
      const allowedSpaceIds = (client.data.allowedSpaceIds ?? new Set()) as Set<
        string
      >;
      let targetSpaceId: string | null = null;

      if (payload.type === 'space') {
        targetSpaceId = await this.spacePolicy.resolveSpaceId(
          user.workspaceId,
          payload.spaceId,
        );
      } else if (payload.type === 'page' && payload.pageId) {
        const page = await this.pageRepo.findById(payload.pageId);
        targetSpaceId =
          page && page.workspaceId === user.workspaceId ? page.spaceId : null;
      }

      if (!targetSpaceId || !allowedSpaceIds.has(targetSpaceId)) {
        return;
      }
    }

    await this.presenceService.updateConnection(
      {
        socketId: client.id,
        user,
        sessionId: client.data.sessionId ?? null,
        deviceName: client.data.deviceName ?? null,
      },
      payload,
    );
  }

  @SubscribeMessage('presence:clear')
  async handlePresenceClear(client: Socket): Promise<void> {
    await this.presenceService.removeConnection(client.id);
  }

  onModuleDestroy() {
    if (this.server) {
      this.server.close();
    }
  }

  /**
   * Builds a canonical room name for space-scoped realtime events.
   *
   * @param spaceId Space identifier.
   * @returns Room name in `space-${spaceId}` format.
   */
  getSpaceRoomName(spaceId: string): string {
    return `space-${spaceId}`;
  }

  emitPageEmbedInvalidation(spaceIds: Iterable<string>): void {
    if (!this.server) return;
    for (const spaceId of new Set(spaceIds)) {
      this.server.to(this.getSpaceRoomName(spaceId)).emit(
        'page-embed:invalidate',
        { operation: 'page_embed_invalidate' },
      );
    }
  }

  /**
   * Validates logical consistency between `targetRoom` and scope identifiers.
   *
   * - `space-*` rooms must match `spaceId`.
   * - `workspace-*` rooms must match `workspaceId`.
   */
  private isPayloadConsistent(payload: WsMessageDto): boolean {
    if (payload.targetRoom.startsWith('space-')) {
      return payload.targetRoom === this.getSpaceRoomName(payload.spaceId);
    }

    if (payload.targetRoom.startsWith('workspace-')) {
      return payload.targetRoom === `workspace-${payload.workspaceId}`;
    }

    return true;
  }

  private extractPageId(data: unknown): string | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const payload = data as Record<string, unknown>;

    if (typeof payload.pageId === 'string' && payload.pageId.length > 0) {
      return payload.pageId;
    }

    if (typeof payload.id === 'string' && payload.id.length > 0) {
      return payload.id;
    }

    const nestedPayload = payload.payload as Record<string, unknown> | undefined;
    if (nestedPayload) {
      if (
        typeof nestedPayload.pageId === 'string' &&
        nestedPayload.pageId.length > 0
      ) {
        return nestedPayload.pageId;
      }

      if (typeof nestedPayload.id === 'string' && nestedPayload.id.length > 0) {
        return nestedPayload.id;
      }

      const node = nestedPayload.node as Record<string, unknown> | undefined;
      if (node && typeof node.id === 'string' && node.id.length > 0) {
        return node.id;
      }
    }

    return null;
  }

  private isRelayDataOperationAllowed(data: Record<string, unknown>): boolean {
    return (
      typeof data.operation === 'string' &&
      (WS_RELAY_EVENT_OPERATIONS as readonly string[]).includes(data.operation)
    );
  }

  private async refreshClientAuthorization(client: Socket): Promise<boolean> {
    const userId = client.data.userId as string | undefined;
    const workspaceId = client.data.workspaceId as string | undefined;
    const sessionId = client.data.sessionId as string | undefined;
    if (!userId || !workspaceId || !sessionId) {
      return false;
    }

    const [user, workspace, session] = await Promise.all([
      this.userRepo.findById(userId, workspaceId),
      this.workspaceRepo.findById(workspaceId),
      this.userSessionRepo.findActiveById(sessionId),
    ]);
    if (
      !user ||
      user.deactivatedAt ||
      user.deletedAt ||
      !workspace ||
      !session ||
      session.userId !== userId ||
      session.workspaceId !== workspaceId
    ) {
      return false;
    }

    const [memberSpaceIds, pageRuleSpaceIds] = await Promise.all([
      this.spaceMemberRepo.getUserSpaceIds(userId),
      this.pageAccessService.getSpaceIdsWithPageRuleAccess(userId, workspaceId),
    ]);
    const userSpaceIds = [...new Set([...memberSpaceIds, ...pageRuleSpaceIds])];
    const allowedSpaceIds = (
      await Promise.all(
        userSpaceIds.map(async (spaceId) => {
          const policy = await this.spacePolicy.resolve(workspaceId, spaceId);
          return policy &&
            this.spacePolicy.evaluateAuthentication(policy.effective, session)
              .satisfied
            ? spaceId
            : null;
        }),
      )
    ).filter((spaceId): spaceId is string => Boolean(spaceId));
    const workspaceAssuranceSatisfied = this.spacePolicy.evaluateAuthentication(
      this.spacePolicy.getWorkspaceValues(workspace),
      session,
    ).satisfied;
    const authorizedRooms = new Set([
      ...(workspaceAssuranceSatisfied
        ? [`user-${userId}`, `workspace-${workspaceId}`]
        : []),
      ...allowedSpaceIds.map((spaceId) => this.getSpaceRoomName(spaceId)),
    ]);
    const previousRooms: Set<string> =
      client.data.authorizedRooms ?? new Set<string>();

    for (const room of previousRooms) {
      if (!authorizedRooms.has(room)) {
        await client.leave(room);
      }
    }
    for (const room of authorizedRooms) {
      if (!client.rooms.has(room)) {
        await client.join(room);
      }
    }

    client.data.authorizedRooms = authorizedRooms;
    client.data.user = user;
    client.data.deviceName = session.deviceName;
    client.data.allowedSpaceIds = new Set(allowedSpaceIds);
    client.data.workspaceAssuranceSatisfied = workspaceAssuranceSatisfied;
    return true;
  }

  private disconnectUnauthorized(client: Socket): void {
    client.emit('Unauthorized');
    client.disconnect();
  }
}
