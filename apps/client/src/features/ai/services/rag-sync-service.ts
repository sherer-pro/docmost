import type {
  RagSyncSpaceConfig,
  RagSyncSpaceConfigUpdate,
  RagSyncTargetTestResult,
} from "@docmost/api-contract";
import api, { unwrapApiResponse } from "@/lib/api-client.ts";

export type RagSyncAction =
  | "enable"
  | "disable"
  | "retry-cleanup"
  | "force-disable"
  | "abandon-cleanup";

export async function getRagSyncSpaceConfig(
  spaceId: string,
): Promise<RagSyncSpaceConfig> {
  const response = await api.get<RagSyncSpaceConfig>(
    `/spaces/${spaceId}/ai/rag-sync`,
  );
  return unwrapApiResponse(response);
}

export async function updateRagSyncSpaceConfig(
  spaceId: string,
  data: RagSyncSpaceConfigUpdate,
): Promise<RagSyncSpaceConfig> {
  const response = await api.patch<RagSyncSpaceConfig>(
    `/spaces/${spaceId}/ai/rag-sync`,
    data,
  );
  return unwrapApiResponse(response);
}

export async function testRagSyncTarget(
  spaceId: string,
): Promise<RagSyncTargetTestResult> {
  const response = await api.post<RagSyncTargetTestResult>(
    `/spaces/${spaceId}/ai/rag-sync/actions/test`,
  );
  return unwrapApiResponse(response);
}

export async function runRagSyncAction(
  spaceId: string,
  action: RagSyncAction,
  expectedVersion: number,
): Promise<RagSyncSpaceConfig> {
  const response = await api.post<RagSyncSpaceConfig>(
    `/spaces/${spaceId}/ai/rag-sync/actions/${action}`,
    action === "abandon-cleanup" || action === "force-disable"
      ? { expectedVersion, confirm: true }
      : { expectedVersion },
  );
  return unwrapApiResponse(response);
}
