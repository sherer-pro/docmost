import {
  AiRetrievalConfig,
  AiRetrievalHit,
  AiRetrievalRequest,
} from '../ai.types';

export interface AiRetrievalAdapter {
  readonly kind: 'none' | 'http-json-v1';

  isConfigured(config: AiRetrievalConfig): boolean;

  test(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<{ ok: true; latencyMs: number }>;

  retrieve(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<AiRetrievalHit[]>;
}
