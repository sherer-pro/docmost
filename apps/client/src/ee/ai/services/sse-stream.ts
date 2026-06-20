import { withCsrfHeader } from "@/lib/api-client.ts";

export interface SseStreamHandlers<TMessage> {
  onMessage: (message: TMessage) => void;
  onComplete?: () => void;
}

export async function fetchJsonSse(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: withCsrfHeader({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
    signal,
    credentials: "include",
  });
}

export async function readServerSentEventStream<TMessage>(
  response: Response,
  handlers: SseStreamHandlers<TMessage>,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) {
          continue;
        }

        const data = line.slice(6);
        if (data === "[DONE]") {
          handlers.onComplete?.();
          return;
        }

        try {
          handlers.onMessage(JSON.parse(data) as TMessage);
        } catch (error) {
          if (error instanceof SyntaxError) {
            continue;
          }

          throw error;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
