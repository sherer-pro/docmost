import { describe, expect, it, vi } from "vitest";
import { readServerSentEventStream } from "./sse-stream";

function createStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  );
}

describe("readServerSentEventStream", () => {
  it("reads split SSE data chunks until DONE", async () => {
    const onMessage = vi.fn();
    const onComplete = vi.fn();

    await readServerSentEventStream(
      createStreamResponse([
        'data: {"content":"hel',
        'lo"}\n',
        'data: {"content":"!"}\n',
        "data: [DONE]\n",
        'data: {"content":"ignored"}\n',
      ]),
      {
        onMessage,
        onComplete,
      },
    );

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenNthCalledWith(1, { content: "hello" });
    expect(onMessage).toHaveBeenNthCalledWith(2, { content: "!" });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("skips invalid JSON messages", async () => {
    const onMessage = vi.fn();

    await readServerSentEventStream(
      createStreamResponse(["data: {invalid}\n", 'data: {"content":"ok"}\n']),
      {
        onMessage,
      },
    );

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ content: "ok" });
  });

  it("propagates handler errors", async () => {
    await expect(
      readServerSentEventStream(
        createStreamResponse(['data: {"error":"provider failed"}\n']),
        {
          onMessage: (message: { error?: string }) => {
            if (message.error) {
              throw new Error(message.error);
            }
          },
        },
      ),
    ).rejects.toThrow("provider failed");
  });
});
