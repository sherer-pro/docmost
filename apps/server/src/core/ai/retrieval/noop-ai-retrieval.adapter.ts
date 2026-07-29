import { Injectable } from '@nestjs/common';
import {
  AiRetrievalConfig,
  AiRetrievalHit,
  AiRetrievalRequest,
} from '../ai.types';
import { AiRetrievalAdapter } from './ai-retrieval.adapter';

@Injectable()
export class NoopAiRetrievalAdapter implements AiRetrievalAdapter {
  readonly kind = 'none' as const;

  isConfigured(): boolean {
    return false;
  }

  async test(
    _config: AiRetrievalConfig,
    _request: AiRetrievalRequest,
  ): Promise<{ ok: true; latencyMs: number }> {
    return { ok: true, latencyMs: 0 };
  }

  async retrieve(
    _config: AiRetrievalConfig,
    _request: AiRetrievalRequest,
  ): Promise<AiRetrievalHit[]> {
    return [];
  }
}
