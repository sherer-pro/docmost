import { Injectable } from '@nestjs/common';
import { AiRun as AiRunEntity } from '@docmost/db/types/entity.types';
import {
  AiConversation,
  AiConversationUpdatedEvent,
  AiRunDeltaEvent,
  AiRunStatusEvent,
} from '@docmost/api-contract';
import { WsGateway } from '../../../ws/ws.gateway';
import { AiOperationalMetricsService } from './ai-operational-metrics.service';

@Injectable()
export class AiRunEventService {
  constructor(
    private readonly ws: WsGateway,
    private readonly metrics: AiOperationalMetricsService,
  ) {}

  emitConversationUpdated(conversation: AiConversation): void {
    const event: AiConversationUpdatedEvent = { conversation };
    this.ws.server
      ?.to(`user-${conversation.userId}`)
      .emit('ai:conversation.updated', event);
  }

  emitDelta(
    run: AiRunEntity,
    sequence: number,
    delta: string,
    reasoningDelta?: string,
  ): void {
    this.metrics.observeDelta(run);
    const event: AiRunDeltaEvent = {
      runId: run.id,
      conversationId: run.conversationId,
      messageId: run.assistantMessageId,
      pageId: run.pageId,
      sequence,
      delta,
      ...(reasoningDelta ? { reasoningDelta } : {}),
    };
    this.ws.server?.to(`user-${run.userId}`).emit('ai:run.delta', event);
  }

  emitStatus(
    run: AiRunEntity,
    sequence: number,
    status: AiRunStatusEvent['status'],
    extra: Partial<AiRunStatusEvent> = {},
  ): void {
    this.metrics.observeStatus(run, status);
    const event: AiRunStatusEvent = {
      runId: run.id,
      conversationId: run.conversationId,
      messageId: run.assistantMessageId,
      pageId: run.pageId,
      sequence,
      status,
      ...extra,
    };
    this.ws.server?.to(`user-${run.userId}`).emit('ai:run.status', event);
  }
}
