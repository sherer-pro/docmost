import { Injectable } from '@nestjs/common';
import {
  AiEditorActionDeltaEvent,
  AiEditorActionStatusEvent,
} from '@docmost/api-contract';
import { AiAuxRun } from '@docmost/db/types/entity.types';
import { WsGateway } from '../../../ws/ws.gateway';

@Injectable()
export class AiAuxRunEventService {
  constructor(private readonly ws: WsGateway) {}

  emitEditorDelta(run: AiAuxRun, sequence: number, delta: string): void {
    if (run.kind !== 'editor_transform') return;
    const event: AiEditorActionDeltaEvent = {
      runId: run.id,
      pageId: run.pageId,
      sequence,
      delta,
    };
    this.ws.server
      ?.to(`user-${run.userId}`)
      .emit('ai:editor-action.delta', event);
  }

  emitEditorStatus(
    run: AiAuxRun,
    status: AiEditorActionStatusEvent['status'],
    errorCode?: string,
  ): void {
    if (run.kind !== 'editor_transform') return;
    const event: AiEditorActionStatusEvent = {
      runId: run.id,
      pageId: run.pageId,
      sequence: run.sequence,
      status,
      ...(errorCode ? { errorCode } : {}),
    };
    this.ws.server
      ?.to(`user-${run.userId}`)
      .emit('ai:editor-action.status', event);
  }
}
