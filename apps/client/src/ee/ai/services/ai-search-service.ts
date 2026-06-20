import { IPageSearchParams } from "@/features/search/types/search.types.ts";
import {
  fetchJsonSse,
  readServerSentEventStream,
} from "@/ee/ai/services/sse-stream.ts";

export interface IAiSearchSource {
  pageId: string;
  title: string;
  slugId: string;
  spaceSlug: string;
  similarity: number;
  distance: number;
  chunkIndex: number;
  excerpt: string;
}

interface AiAnswersStreamChunk {
  content?: string;
  sources?: IAiSearchSource[];
  error?: string;
}

export interface IAiSearchResponse {
  answer: string;
  sources?: IAiSearchSource[];
}

export async function aiAnswers(
  params: IPageSearchParams,
  onChunk?: (chunk: { content?: string; sources?: IAiSearchSource[] }) => void,
): Promise<IAiSearchResponse> {
  const response = await fetchJsonSse("/api/ai/answers", params);

  let answer = "";
  let sources: IAiSearchSource[] = [];

  await readServerSentEventStream<AiAnswersStreamChunk>(response, {
    onMessage: (parsed) => {
      if (parsed.error) {
        throw new Error(parsed.error);
      }

      if (parsed.content) {
        answer += parsed.content;
        onChunk?.({ content: parsed.content });
      }

      if (parsed.sources) {
        sources = parsed.sources;
        onChunk?.({ sources: parsed.sources });
      }
    },
  });

  return { answer, sources };
}
