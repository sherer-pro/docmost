import {
  AiRetrievalConfig,
  AiRetrievalHit,
  AiRetrievalRequest,
} from '../ai.types';

export interface AiRetrievalAdapter {
  readonly kind:
    | 'none'
    | 'http-json-v1'
    | 'open-webui-knowledge-v1';

  isConfigured(config: AiRetrievalConfig): boolean;

  test(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<{
    ok: true;
    latencyMs: number;
    adapter?: AiRetrievalConfig['adapter'];
    remoteVersion?: string;
    candidateCount?: number;
    validCandidateCount?: number;
    state?: 'ready' | 'empty';
  }>;

  retrieve(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<AiRetrievalHit[]>;
}
