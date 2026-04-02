import {
  MessageBody,
  OnGatewayConnection,
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
import { WsMessageDto } from './dto/ws-message.dto';
import { createCorsOriginValidator } from '../common/security/cors.util';
import { PageAccessService } from '../core/page-access/page-access.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { User } from '@docmost/db/types/entity.types';

const wsCorsOriginValidator = createCorsOriginValidator();

@WebSocketGateway({
  cors: { origin: wsCorsOriginValidator, credentials: true },
  transports: ['websocket'],
})
export class WsGateway implements OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(WsGateway.name);

  @WebSocketServer()
  server: Server;
  constructor(
    private tokenService: TokenService,
    private spaceMemberRepo: SpaceMemberRepo,
    private readonly userRepo: UserRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

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
      const user = await this.userRepo.findById(userId, workspaceId);
      if (!user) {
        throw new Error('Unauthorized');
      }

      const [memberSpaceIds, pageRuleSpaceIds] = await Promise.all([
        this.spaceMemberRepo.getUserSpaceIds(userId),
        this.pageAccessService.getSpaceIdsWithPageRuleAccess(userId, workspaceId),
      ]);
      const userSpaceIds = [...new Set([...memberSpaceIds, ...pageRuleSpaceIds])];

      const userRoom = `user-${userId}`;
      const workspaceRoom = `workspace-${workspaceId}`;
      const spaceRooms = userSpaceIds.map((id) => this.getSpaceRoomName(id));
      const authorizedRooms = new Set([userRoom, workspaceRoom, ...spaceRooms]);

      /**
       * Keep allowed room names in socket context for strict server-side checks.
       * This prevents a client from relaying events to arbitrary rooms by
       * tampering with payload values.
       */
      client.data.authorizedRooms = authorizedRooms;
      client.data.user = user;

      client.join([...authorizedRooms]);
    } catch (err) {
      client.emit('Unauthorized');
      client.disconnect();
    }
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

    const authorizedRooms: Set<string> = client.data.authorizedRooms ?? new Set();

    if (!this.isPayloadConsistent(payload)) {
      this.logger.warn(
        `Invalid targetRoom/spaceId/workspaceId combination from client ${client.id}`,
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
        if (!page || page.deletedAt) {
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
}
