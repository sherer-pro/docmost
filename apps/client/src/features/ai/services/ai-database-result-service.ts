import api, { unwrapApiResponse } from "@/lib/api-client";
import type {
  AiDatabaseResultCard,
  AiDatabaseResultRows,
} from "@docmost/api-contract";

export async function getAiDatabaseResults(
  runId: string,
): Promise<AiDatabaseResultCard[]> {
  return unwrapApiResponse<AiDatabaseResultCard[]>(
    await api.get(`/ai/runs/${runId}/database-results`),
  );
}

export async function getAiDatabaseResultRows(
  runId: string,
  stepId: string,
  cursor?: string,
): Promise<AiDatabaseResultRows> {
  return unwrapApiResponse<AiDatabaseResultRows>(
    await api.get(`/ai/runs/${runId}/steps/${stepId}/database-result`, {
      params: cursor ? { cursor } : {},
    }),
  );
}
