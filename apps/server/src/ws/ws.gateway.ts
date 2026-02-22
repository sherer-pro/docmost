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

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class WsGateway implements OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(WsGateway.name);

  @WebSocketServer()
  server: Server;
  constructor(
    private tokenService: TokenService,
    private spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async handleConnection(client: Socket, ...args: any[]): Promise<void> {
    try {
      const cookies = cookie.parse(client.handshake.headers.cookie);
      const token: JwtPayload = await this.tokenService.verifyJwt(
        cookies['authToken'],
        JwtType.ACCESS,
      );

      const userId = token.sub;
      const workspaceId = token.workspaceId;

      const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);

      const userRoom = `user-${userId}`;
      const workspaceRoom = `workspace-${workspaceId}`;
      const spaceRooms = userSpaceIds.map((id) => this.getSpaceRoomName(id));
      const authorizedRooms = new Set([userRoom, workspaceRoom, ...spaceRooms]);

      /**
       * Сохраняем список разрешённых комнат в контексте сокета.
       * Это нужно для жёсткой серверной проверки, чтобы клиент не мог
       * ретранслировать событие в произвольную комнату через подмену payload.
       */
      client.data.authorizedRooms = authorizedRooms;

      client.join([...authorizedRooms]);
    } catch (err) {
      client.emit('Unauthorized');
      client.disconnect();
    }
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, data: any): void {
    const payload = plainToInstance(WsMessageDto, data);
    const validationErrors = validateSync(payload, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (validationErrors.length > 0) {
      this.logger.warn(
        `Невалидный WS payload от клиента ${client.id}: ${JSON.stringify(validationErrors)}`,
      );
      return;
    }

    const authorizedRooms: Set<string> = client.data.authorizedRooms ?? new Set();

    if (!this.isPayloadConsistent(payload)) {
      this.logger.warn(
        `Невалидная связка targetRoom/spaceId/workspaceId от клиента ${client.id}`,
      );
      return;
    }

    /**
     * Запрещаем global broadcast по умолчанию.
     * Ретрансляция разрешена только в явно указанную комнату, выданную на connect.
     */
    if (!authorizedRooms.has(payload.targetRoom)) {
      this.logger.warn(
        `Клиент ${client.id} попытался отправить событие в неразрешённую комнату ${payload.targetRoom}`,
      );
      return;
    }

    /**
     * Дополнительная проверка членства в комнате на уровне socket.io.
     * Даже если комната есть в списке разрешённых, клиент должен реально состоять в ней.
     */
    if (!client.rooms.has(payload.targetRoom)) {
      this.logger.warn(
        `Клиент ${client.id} не состоит в комнате ${payload.targetRoom}, ретрансляция отклонена`,
      );
      return;
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

  getSpaceRoomName(spaceId: string): string {
    return `space-${spaceId}`;
  }

  /**
   * Проверяем логическую целостность payload:
   * - для `space-*` room ожидаем совпадение с `spaceId`;
   * - для `workspace-*` room ожидаем совпадение с `workspaceId`.
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
}
