import {
  Global,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AuthenticationExtension } from './extensions/authentication.extension';
import { PersistenceExtension } from './extensions/persistence.extension';
import { CollaborationGateway } from './collaboration.gateway';
import { HttpAdapterHost } from '@nestjs/core';
import { CollabWsAdapter } from './adapter/collab-ws.adapter';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { TokenModule } from '../core/auth/token.module';
import { HistoryProcessor } from './processors/history.processor';
import { LoggerExtension } from './extensions/logger.extension';
import { CollaborationHandler } from './collaboration.handler';
import { WatcherModule } from '../core/watcher/watcher.module';
import { TransclusionPersistenceModule } from '../core/page/transclusion/transclusion.module';
import { PageAccessModule } from '../core/page-access/page-access.module';
import { SpacePolicyModule } from '../core/space-policy/space-policy.module';
import { CollabPageUpdatePublisherService } from './services/collab-page-update-publisher.service';
import { CollaborationHistoryModule } from './services/collaboration-history.module';

@Module({
  providers: [
    CollaborationGateway,
    AuthenticationExtension,
    PersistenceExtension,
    LoggerExtension,
    HistoryProcessor,
    CollaborationHandler,
    CollabPageUpdatePublisherService,
  ],
  exports: [CollaborationGateway],
  imports: [
    TokenModule,
    WatcherModule,
    TransclusionPersistenceModule,
    PageAccessModule,
    SpacePolicyModule,
    CollaborationHistoryModule,
  ],
})
export class CollaborationRuntimeModule
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CollaborationRuntimeModule.name);
  private collabWsAdapter: CollabWsAdapter;
  private path = '/collab';

  constructor(
    private readonly collaborationGateway: CollaborationGateway,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  onModuleInit() {
    this.collabWsAdapter = new CollabWsAdapter();
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();

    const wss = this.collabWsAdapter.handleUpgrade(this.path, httpServer);

    wss.on('connection', (client: WebSocket, request: IncomingMessage) => {
      this.collaborationGateway.handleConnection(client, request);

      client.on('error', (error) => {
        this.logger.error('WebSocket client error:', error);
      });
    });

    wss.on('error', (error) =>
      this.logger.error('WebSocket server error:', error),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.collaborationGateway?.destroy(this.collabWsAdapter);
    this.collabWsAdapter?.destroy();
  }
}
