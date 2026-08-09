// Source https://github.com/ueberdosis/hocuspocus/pull/1008 - MIT
import {
  Extension,
  Hocuspocus,
  IncomingMessage,
  afterUnloadDocumentPayload,
  onConfigurePayload,
  onLoadDocumentPayload,
} from '@hocuspocus/server';
import RedisClient from 'ioredis';
import { readVarString } from 'lib0/decoding.js';
import {
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CollabProxySocket } from './collab-proxy-socket';
import {
  BaseWebSocket,
  Configuration,
  CustomEvents,
  Pack,
  RSAMessage,
  RSAMessageCloseProxy,
  RSAMessageCustomEventComplete,
  RSAMessageCustomEventStart,
  RSAMessagePong,
  RSAMessageProxy,
  RSAMessageUnload,
  SerializedHTTPRequest,
  Unpack,
} from './redis-sync.types';

export type { Pack, SerializedHTTPRequest } from './redis-sync.types';

type ServerId = string;
type DocumentName = string;
type SocketId = string;

type SerializedCustomEventError = NonNullable<
  RSAMessageCustomEventComplete['error']
>;

export const RENEW_DOCUMENT_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

export const RELEASE_DOCUMENT_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export function serializeCustomEventError(
  error: unknown,
): SerializedCustomEventError {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    return {
      status: error.getStatus(),
      response: typeof response === 'string' ? response : { ...response },
      message: error.message,
    };
  }
  return {
    status: 500,
    response: { message: 'Collaboration operation failed' },
    message: 'Collaboration operation failed',
  };
}

export function deserializeCustomEventError(
  error: SerializedCustomEventError,
): HttpException {
  return new HttpException(error.response, error.status);
}

export class RedisSyncExtension<TCE extends CustomEvents> implements Extension {
  priority = 1000;
  private readonly logger = new Logger(RedisSyncExtension.name);
  private readonly source: RedisClient;
  private readonly pub: RedisClient;
  private sub: RedisClient;
  private readonly pack: Pack;
  private readonly unpack: Unpack;
  private originSockets: Record<SocketId, BaseWebSocket> = {};
  private locks: Record<DocumentName, NodeJS.Timeout> = {};
  private lockPromises: Record<DocumentName, Promise<ServerId | null>> = {};
  private readonly lostLocks = new Set<DocumentName>();
  private readonly leaseLosses: Record<DocumentName, Promise<void>> = {};
  private proxySockets: Record<SocketId, CollabProxySocket> = {};
  private readonly prefix: string;
  private readonly lockPrefix: string;
  private readonly msgChannel: string;
  private readonly serverId: ServerId;
  private readonly customEventTTL: number;
  private readonly lockTTL: number;
  private instance!: Hocuspocus;
  private destroyed = false;
  private readonly customEvents: TCE;
  private replyIdCounter: number = 0;
  private pendingReplies: Record<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timeout: NodeJS.Timeout;
    }
  > = {};

  constructor(configuration: Configuration<TCE>) {
    const {
      redis,
      pack,
      unpack,
      serverId,
      lockTTL,
      prefix,
      customEvents,
      customEventTTL,
    } = configuration;
    this.source = redis;
    this.pub = redis.duplicate();
    this.sub = redis.duplicate();
    this.pack = pack;
    this.unpack = unpack;
    this.serverId = serverId;
    this.lockTTL = lockTTL ?? 10_000;
    this.customEventTTL = customEventTTL ?? 30_000;
    this.prefix = prefix ?? 'collab';
    this.lockPrefix = `${this.prefix}Lock`;
    this.msgChannel = `${this.prefix}Msg`;
    this.customEvents = (customEvents as any) ?? ({} as any as CustomEvents);
    void this.sub
      .subscribe(this.msgChannel, `${this.msgChannel}:${this.serverId}`)
      .catch(() => {
        this.logger.error(
          'Failed to subscribe to collaboration Redis channels',
        );
      });
    this.sub.on('messageBuffer', this.handleRedisMessage);
    this.pub.on('error', () => {
      this.logger.error('Collaboration Redis publisher error');
    });
    this.sub.on('error', () => {
      this.logger.error('Collaboration Redis subscriber error');
    });
  }
  private getKey(documentName: string) {
    return `${this.lockPrefix}:${documentName}`;
  }

  private closeProxy(socketId: string) {
    const proxySocket = this.proxySockets[socketId];
    if (proxySocket) {
      proxySocket.emit(
        'close',
        1000,
        Buffer.from('provider_initiated', 'utf-8'),
      );
      delete this.proxySockets[socketId];
    }
  }

  closeProxyConnectionsForShutdown(): void {
    Object.keys(this.proxySockets).forEach((socketId) =>
      this.closeProxy(socketId),
    );
  }

  private pongProxy(socketId: string) {
    this.proxySockets[socketId]?.emit('pong');
  }

  private async handleProxyMessage(
    msg: Pick<RSAMessageProxy, 'replyTo' | 'message' | 'serializedHTTPRequest'>,
  ) {
    const { replyTo, message, serializedHTTPRequest } = msg;
    const { headers } = serializedHTTPRequest;
    const socketId = headers['sec-websocket-key']!;
    let socket = this.proxySockets[socketId];
    if (!socket) {
      socket = new CollabProxySocket(
        this.pub,
        this.pack,
        replyTo,
        `${this.msgChannel}:${this.serverId}`,
        socketId,
      );
      this.proxySockets[socketId] = socket;
      await this.instance.handleConnection(
        socket as any,
        serializedHTTPRequest as any,
        {},
      );
    }
    socket.emit('message', message);
  }

  private getOrClaimLock(documentName: string): Promise<ServerId | null> {
    const lockPromise = this.pub
      .set(
        this.getKey(documentName),
        this.serverId,
        'PX',
        this.lockTTL,
        'NX',
        'GET',
      )
      .then((owner) => {
        if (owner === null) {
          this.lostLocks.delete(documentName);
        }
        return owner;
      })
      .catch((error) => {
        if (this.lockPromises[documentName] === lockPromise) {
          delete this.lockPromises[documentName];
        }
        throw error;
      });
    this.lockPromises[documentName] = lockPromise;
    // Briefly cache the serverId that claimed the doc to reduce load on redis
    // When the claimant unloads the doc, it will send an unload message to immediately clear this
    // a lockTTL / 2 guarantees stale reads < lockTTL upon server crash
    setTimeout(() => {
      if (this.lockPromises[documentName] === lockPromise) {
        delete this.lockPromises[documentName];
      }
    }, this.lockTTL / 2);
    return lockPromise;
  }

  private getOrClaimLockThrottled(documentName: string) {
    const existingWorkerIdPromise = this.lockPromises[documentName];
    if (existingWorkerIdPromise) return existingWorkerIdPromise;
    return this.getOrClaimLock(documentName);
  }

  private handleRedisMessage = (
    _channel: Buffer,
    packedMessage: Buffer,
  ): void => {
    void this.processRedisMessage(packedMessage).catch(() => {
      this.logger.error('Failed to process a collaboration Redis message');
    });
  };

  private async processRedisMessage(packedMessage: Buffer): Promise<void> {
    const msg = this.unpack(packedMessage) as RSAMessage;
    const { type } = msg;
    if (type === 'proxy') {
      await this.handleProxyMessage(msg);
      return;
    }
    if (type === 'closeProxy') {
      this.closeProxy(msg.socketId);
      return;
    }
    if (type === 'pong') {
      this.pongProxy(msg.socketId);
      return;
    }
    if (type === 'unload') {
      delete this.lockPromises[msg.documentName];
      return;
    }
    if (type === 'customEventStart') {
      const { documentName, eventName, payload, replyTo, replyId } = msg;
      let reply: RSAMessageCustomEventComplete;
      try {
        await this.assertOwnsDocumentLock(documentName);
        const result = await this.handleEventLocally(
          eventName as Extract<keyof TCE, string>,
          documentName,
          payload,
        );
        reply = {
          type: 'customEventComplete',
          replyId,
          payload: result,
        };
      } catch (error) {
        reply = {
          type: 'customEventComplete',
          replyId,
          error: serializeCustomEventError(error),
        };
      }
      await this.pub.publish(`${replyTo}`, this.pack(reply));
      return;
    }
    if (type === 'customEventComplete') {
      const { replyId, payload, error } = msg;
      const pending = this.pendingReplies[replyId];
      if (!pending) return;
      delete this.pendingReplies[replyId];
      clearTimeout(pending.timeout);
      if (error) {
        pending.reject(deserializeCustomEventError(error));
      } else {
        pending.resolve(payload);
      }
      return;
    }
    const { socketId } = msg;
    const socket = this.originSockets[socketId];
    if (!socket) {
      // origin socket already cleaned up
      return;
    }
    if (type === 'close') {
      socket.close(msg.code, msg.reason);
    } else if (type === 'ping') {
      // Reply instantly to the proxy socket, without forwarding to client
      // The origin socket handles heartbeat for itself
      const { replyTo, socketId } = msg;
      const reply: RSAMessagePong = {
        type: 'pong',
        socketId,
      };
      await this.pub.publish(`${replyTo}`, this.pack(reply));
    } else if (type === 'send') {
      socket.send(msg.message);
    }
  }

  async maintainLock(documentName: string): Promise<void> {
    this.stopMaintainingLock(documentName);
    const renewed = await this.renewOwnedLock(documentName);
    if (!renewed) {
      await this.handleLeaseLoss(documentName, 'ownership');
      throw new Error('Could not maintain collaboration document lock');
    }
    this.scheduleLockRenewal(documentName);
  }

  async releaseLock(documentName: string): Promise<number> {
    this.stopMaintainingLock(documentName);
    delete this.lockPromises[documentName];
    const released = await this.pub.eval(
      RELEASE_DOCUMENT_LOCK_SCRIPT,
      1,
      this.getKey(documentName),
      this.serverId,
    );
    if (!this.instance?.documents.has(documentName)) {
      this.lostLocks.delete(documentName);
    }
    return Number(released);
  }

  private stopMaintainingLock(documentName: string): void {
    clearTimeout(this.locks[documentName]);
    delete this.locks[documentName];
  }

  private scheduleLockRenewal(documentName: string): void {
    if (this.destroyed || this.lostLocks.has(documentName)) {
      return;
    }

    this.locks[documentName] = setTimeout(() => {
      delete this.locks[documentName];
      void this.renewLockAndReschedule(documentName);
    }, this.lockTTL / 2);
  }

  private async renewLockAndReschedule(documentName: string): Promise<void> {
    try {
      const renewed = await this.renewOwnedLock(documentName);
      if (!renewed) {
        await this.handleLeaseLoss(documentName, 'ownership');
        return;
      }
      this.scheduleLockRenewal(documentName);
    } catch {
      this.logger.error('Failed to renew a collaboration document lock');
      await this.handleLeaseLoss(documentName, 'redis');
    }
  }

  private async renewOwnedLock(documentName: string): Promise<boolean> {
    const renewed = await this.pub.eval(
      RENEW_DOCUMENT_LOCK_SCRIPT,
      1,
      this.getKey(documentName),
      this.serverId,
      String(this.lockTTL),
    );
    return Number(renewed) === 1;
  }

  private async assertOwnsDocumentLock(documentName: string): Promise<void> {
    try {
      if (await this.renewOwnedLock(documentName)) {
        return;
      }
      await this.handleLeaseLoss(documentName, 'ownership');
    } catch {
      await this.handleLeaseLoss(documentName, 'redis');
    }
    throw new ServiceUnavailableException(
      'Collaboration document is reconnecting',
    );
  }

  private async handleLeaseLoss(
    documentName: string,
    reason: 'ownership' | 'redis',
  ): Promise<void> {
    const existing = this.leaseLosses[documentName];
    if (existing) {
      return existing;
    }

    const leaseLoss = (async () => {
      this.stopMaintainingLock(documentName);
      delete this.lockPromises[documentName];
      this.lostLocks.add(documentName);
      this.logger.error(
        `Collaboration document lease lost; closing local connections (${reason})`,
      );

      if (!this.instance) {
        return;
      }

      this.instance.closeConnections(documentName);
      const document = this.instance.documents.get(documentName);
      if (document) {
        await this.instance.unloadDocument(document);
        if (this.instance.documents.has(documentName)) {
          this.logger.warn(
            'Collaboration document unload was deferred by pending persistence work',
          );
        }
      }
    })().finally(() => {
      delete this.leaseLosses[documentName];
    });

    this.leaseLosses[documentName] = leaseLoss;
    return leaseLoss;
  }

  private assertLoadedDocumentLease(documentName: string): void {
    if (
      this.lostLocks.has(documentName) &&
      this.instance.documents.has(documentName)
    ) {
      throw new ServiceUnavailableException(
        'Collaboration document is reconnecting',
      );
    }
  }

  private async handleEventLocally<TName extends Extract<keyof TCE, string>>(
    eventName: TName,
    documentName: string,
    payload: any,
  ) {
    const handler = this.customEvents[eventName];
    if (!handler) throw new Error(`Invalid eventName: ${eventName}`);
    const result = await handler(documentName, payload);
    return result as Promise<ReturnType<TCE[TName]>>;
  }

  async handleEvent<TName extends Extract<keyof TCE, string>>(
    eventName: TName,
    documentName: string,
    payload: any,
  ) {
    const isDocLoadedOnInstance = this.instance.documents.has(documentName);

    if (isDocLoadedOnInstance) {
      this.assertLoadedDocumentLease(documentName);
      return this.handleEventLocally(eventName, documentName, payload);
    }

    const proxyTo = await this.getOrClaimLockThrottled(documentName);
    if (proxyTo && proxyTo !== this.serverId) {
      ++this.replyIdCounter; // bug in biome thinks this.replyIdCounter is not used if written on the line below
      const replyId = this.replyIdCounter;
      // another server owns the doc
      const proxyMessage: RSAMessageCustomEventStart = {
        eventName,
        documentName,
        payload,
        replyTo: `${this.msgChannel}:${this.serverId}`,
        replyId,
        type: 'customEventStart',
      };
      const msg = this.pack(proxyMessage);
      let resolve!: (value: unknown) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      const timeout = setTimeout(() => {
        delete this.pendingReplies[replyId];
        reject(new Error('Collaboration event timed out'));
      }, this.customEventTTL);
      this.pendingReplies[replyId] = { resolve, reject, timeout };
      try {
        await this.pub.publish(`${this.msgChannel}:${proxyTo}`, msg);
      } catch (error) {
        delete this.pendingReplies[replyId];
        clearTimeout(timeout);
        throw error;
      }
      return promise as Promise<ReturnType<TCE[TName]>>;
    }
    // This server owns the document, but hocuspocus hasn't loaded it yet
    return this.handleEventLocally(eventName, documentName, payload);
  }

  async lockDocument(documentName: string) {
    this.assertLoadedDocumentLease(documentName);
    const proxyTo = await this.getOrClaimLockThrottled(documentName);
    if (proxyTo && proxyTo !== this.serverId) {
      throw new Error(`Could not lock document: ${documentName}`);
    }
    await this.maintainLock(documentName);
    return () => this.releaseLock(documentName);
  }

  /* WebSocket Server Hooks */
  onSocketOpen(
    ws: BaseWebSocket,
    serializedHTTPRequest: SerializedHTTPRequest,
    context = {},
  ) {
    const socketId = serializedHTTPRequest.headers['sec-websocket-key']!;
    this.originSockets[socketId] = ws;
    try {
      this.instance.handleConnection(
        ws as any,
        serializedHTTPRequest as any,
        context,
      );
    } catch {
      this.logger.error('Failed to initialize a collaboration connection');
      ws.close(1011, 'Collaboration connection failed');
    }
  }

  async onSocketMessage(
    ws: BaseWebSocket,
    serializedHTTPRequest: SerializedHTTPRequest,
    detachableMsg: ArrayBuffer,
  ) {
    const message = new Uint8Array(detachableMsg.slice());
    const tmpMsg = new IncomingMessage(detachableMsg);
    const documentName = readVarString(tmpMsg.decoder);
    const isDocLoadedOnInstance = this.instance.documents.has(documentName);

    if (isDocLoadedOnInstance) {
      try {
        this.assertLoadedDocumentLease(documentName);
      } catch {
        ws.close(1012, 'Collaboration document is reconnecting');
        return;
      }
      ws.emit('message', message);
      return;
    }

    const proxyTo = await this.getOrClaimLockThrottled(documentName);
    if (proxyTo && proxyTo !== this.serverId) {
      // another server owns the doc
      const proxyMessage: RSAMessageProxy = {
        serializedHTTPRequest: serializedHTTPRequest,
        replyTo: `${this.msgChannel}:${this.serverId}`,
        message,
        type: 'proxy',
      };
      const msg = this.pack(proxyMessage);
      await this.pub.publish(`${this.msgChannel}:${proxyTo}`, msg);
      return;
    }
    // This server owns the document, but hocuspocus hasn't loaded it yet
    ws.emit('message', message);
  }

  onSocketClose(socketId: string, code?: number, reason?: ArrayBuffer) {
    const socket = this.originSockets[socketId];
    if (!socket) return;
    // at this point the socket is considered GC'd and we cannot call close
    // The origin socket did not set up any connections for the proxy, so none of the hooks will work if we just emit
    socket?.emit('close', code, reason);
    delete this.originSockets[socketId];
    const msg: RSAMessageCloseProxy = { type: 'closeProxy', socketId };
    void this.pub.publish(this.msgChannel, this.pack(msg)).catch(() => {
      this.logger.error('Failed to publish collaboration proxy close');
    });
  }

  /* Hocuspocus hooks */
  async onConfigure({ instance }: onConfigurePayload) {
    this.instance = instance;
  }

  async onLoadDocument(data: onLoadDocumentPayload) {
    const { documentName } = data;
    // Refresh the lock TTL
    await this.maintainLock(documentName);
  }

  async afterUnloadDocument(data: afterUnloadDocumentPayload) {
    const { documentName } = data;
    try {
      await this.releaseLock(documentName);
    } catch {
      this.logger.error('Failed to release a collaboration document lock');
    }
    // Broadcast to cluster to immediately remove the cached redis value
    const msg: RSAMessageUnload = { type: 'unload', documentName };
    try {
      await this.pub.publish(this.msgChannel, this.pack(msg));
    } catch {
      this.logger.error('Failed to publish collaboration document unload');
    }
  }

  async onDestroy() {
    this.destroyed = true;
    this.closeProxyConnectionsForShutdown();
    Object.keys(this.locks).forEach((documentName) =>
      this.stopMaintainingLock(documentName),
    );
    Object.values(this.pendingReplies).forEach(({ timeout, reject }) => {
      clearTimeout(timeout);
      reject(new Error('Collaboration server is shutting down'));
    });
    this.pendingReplies = {};
    this.source.disconnect(false);
    this.pub.disconnect(false);
    this.sub.disconnect(false);
  }
}
