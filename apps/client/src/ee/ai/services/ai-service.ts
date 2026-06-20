import api from "@/lib/api-client.ts";
import {
  AiGenerateDto,
  AiContentResponse,
  AiStreamChunk,
  AiStreamError,
} from "@/ee/ai/types/ai.types.ts";
import {
  fetchJsonSse,
  readServerSentEventStream,
} from "@/ee/ai/services/sse-stream.ts";

export async function generateAiContent(
  data: AiGenerateDto,
): Promise<AiContentResponse> {
  const req = await api.post<AiContentResponse>("/ai/generate", data);
  return req.data;
}

export async function generateAiContentStream(
  data: AiGenerateDto,
  onChunk: (chunk: AiStreamChunk) => void,
  onError?: (error: AiStreamError) => void,
  onComplete?: () => void,
): Promise<AbortController> {
  const abortController = new AbortController();
  try {
    const response = await fetchJsonSse(
      "/api/ai/generate/stream",
      data,
      abortController.signal,
    );

    void readServerSentEventStream<AiStreamChunk | AiStreamError>(response, {
      onMessage: (parsed) => {
        if ("error" in parsed) {
          onError?.(parsed);
          return;
        }

        onChunk(parsed);
      },
      onComplete,
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      onError?.({
        error: error instanceof Error ? error.message : "Unknown stream error",
      });
    });
  } catch (error) {
    onError?.({
      error: error instanceof Error ? error.message : "Unknown stream error",
    });
  }

  return abortController;
}
