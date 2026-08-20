export const RAG_SYNC_BINDING_STATES = [
  "disabled",
  "enabled",
  "draining",
] as const;
export type RagSyncBindingState = (typeof RAG_SYNC_BINDING_STATES)[number];

export const RAG_SYNC_HEALTH_STATES = [
  "disabled",
  "idle",
  "syncing",
  "healthy",
  "degraded",
  "error",
] as const;
export type RagSyncHealthState = (typeof RAG_SYNC_HEALTH_STATES)[number];

export const RAG_SYNC_ADAPTERS = ["open-webui-knowledge-v1"] as const;
export type RagSyncAdapter = (typeof RAG_SYNC_ADAPTERS)[number];

export const RAG_SYNC_ERROR_CODES = [
  "rag_sync_deployment_disabled",
  "rag_sync_not_configured",
  "rag_sync_target_not_tested",
  "rag_sync_target_mismatch",
  "rag_sync_target_in_use",
  "rag_sync_config_conflict",
  "rag_sync_cleanup_required",
  "rag_sync_cleanup_in_progress",
  "rag_sync_invalid_state",
  "rag_sync_writer_unavailable",
  "rag_sync_writer_unauthorized",
  "rag_sync_target_unavailable",
  "rag_sync_target_invalid",
  "rag_sync_target_timeout",
  "rag_sync_processing_timeout",
  "rag_sync_processing_failed",
  "rag_sync_invalid_response",
  "rag_sync_redirect_rejected",
  "rag_sync_source_too_large",
  "rag_sync_url_rejected",
  "rag_sync_writer_key_missing",
  "rag_sync_lease_lost",
  "rag_sync_aborted",
  "rag_sync_internal_error",
  "rag_sync_scope_unavailable",
  "rag_sync_invalid_feed",
] as const;
export type RagSyncErrorCode = (typeof RAG_SYNC_ERROR_CODES)[number];

export interface RagSyncStatus {
  health: RagSyncHealthState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lagMs: number | null;
  errorCode: RagSyncErrorCode | null;
}

export interface RagSyncSpaceConfig {
  deploymentEnabled: boolean;
  bindingId: string | null;
  state: RagSyncBindingState;
  configVersion: number | null;
  target: {
    adapter: RagSyncAdapter;
    baseUrl: string | null;
    knowledgeId: string | null;
    writerApiKeyConfigured: boolean;
    lastTestedAt: string | null;
  };
  cleanupRequired: boolean;
  status: RagSyncStatus;
}

export interface RagSyncSpaceConfigUpdate {
  expectedVersion: number | null;
  target?: {
    adapter?: RagSyncAdapter;
    baseUrl?: string | null;
    knowledgeId?: string | null;
    writerApiKey?: string;
    clearWriterApiKey?: boolean;
  };
}

export interface RagSyncTargetTestResult {
  ok: true;
  latencyMs: number;
}

export interface RagSyncActionRequest {
  expectedVersion: number;
}

export interface RagSyncDestructiveActionRequest extends RagSyncActionRequest {
  confirm: true;
}
