import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { RedisOptions } from 'ioredis';
import {
  createRetryStrategy,
  parseRedisUrl,
  RedisConfig,
} from '../../common/helpers';

export class WsRedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private redisConfig: RedisConfig;
  private pubClient?: Redis;
  private subClient?: Redis;

  async connectToRedis(): Promise<void> {
    this.redisConfig = parseRedisUrl(process.env.REDIS_URL);

    const options: RedisOptions = {
      family: this.redisConfig.family,
      retryStrategy: createRetryStrategy(),
    };

    this.pubClient = new Redis(process.env.REDIS_URL, options);
    this.subClient = new Redis(process.env.REDIS_URL, options);

    this.pubClient.on('error', () => {});
    this.subClient.on('error', () => {});

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }

  async dispose(): Promise<void> {
    this.pubClient?.disconnect(false);
    this.subClient?.disconnect(false);
    this.pubClient = undefined;
    this.subClient = undefined;
  }
}
