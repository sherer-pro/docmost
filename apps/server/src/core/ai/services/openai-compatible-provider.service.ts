import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import {
  AiProviderConfig,
  AiProviderMessage,
  AiProviderUsage,
} from '../ai.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { AiProviderUrlPolicyService } from './ai-provider-url-policy.service';

type ProviderResponse<T> = {
  data: T;
  response: Response;
};

type ProviderAbortReason =
  | 'request_timeout'
  | 'stream_idle_timeout'
  | 'cancelled';

const PROVIDER_JSON_MAX_BYTES = 4 * 1024 * 1024;
const PROVIDER_SSE_FRAME_MAX_BYTES = 256 * 1024;
const PROVIDER_SSE_BUFFER_MAX_BYTES = 1024 * 1024;
const PROVIDER_STREAM_CONTENT_MAX_CHARS = 8 * 1024 * 1024;

export class AiProviderRequestCancelledError extends Error {
  constructor() {
    super('AI provider request was cancelled');
    this.name = 'AiProviderRequestCancelledError';
  }
}

export class AiProviderInvalidResponseError extends BadGatewayException {
  readonly aiErrorCode = 'provider_invalid_response';
}

@Injectable()
export class OpenAiCompatibleProviderService {
  constructor(
    private readonly urlPolicy: AiProviderUrlPolicyService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async listModels(
    config: Pick<AiProviderConfig, 'baseUrl' | 'apiKey' | 'requestTimeoutMs'>,
  ): Promise<string[]> {
    const { data } = await this.requestJson<{ data?: Array<{ id?: string }> }>(
      config,
      'models',
      { method: 'GET' },
    );
    return (data.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === 'string');
  }

  async complete(
    config: AiProviderConfig,
    messages: AiProviderMessage[],
  ): Promise<{ content: string; usage: AiProviderUsage }> {
    const { data } = await this.requestJson<any>(config, 'chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: config.chatModel,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxOutputTokens,
        stream: false,
      }),
    });

    return {
      content: this.readMessageContent(data?.choices?.[0]?.message?.content),
      usage: this.readUsage(data?.usage),
    };
  }

  async stream(
    config: AiProviderConfig,
    messages: AiProviderMessage[],
    handlers: {
      onText: (text: string) => Promise<void> | void;
      onUsage?: (usage: AiProviderUsage) => Promise<void> | void;
      onActivity?: () => Promise<void> | void;
      isCancelled?: () => Promise<boolean> | boolean;
    },
  ): Promise<AiProviderUsage> {
    const request = await this.openRequest(
      config,
      'chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: config.chatModel,
          messages,
          temperature: config.temperature,
          max_tokens: config.maxOutputTokens,
          stream: true,
          stream_options: { include_usage: true },
        }),
      },
      true,
      handlers.isCancelled,
    );

    const response = request.response;
    if (!response.body) {
      request.cleanup();
      throw new AiProviderInvalidResponseError(
        'AI provider returned an empty stream',
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: AiProviderUsage = { inputTokens: 0, outputTokens: 0 };
    let done = false;
    let bodyDone = false;
    let readingStream = false;
    let contentChars = 0;
    const frameHandlers = {
      onText: async (text: string) => {
        contentChars += text.length;
        if (contentChars > PROVIDER_STREAM_CONTENT_MAX_CHARS) {
          throw new AiProviderInvalidResponseError(
            'AI provider stream exceeded the content limit',
          );
        }
        await handlers.onText(text);
      },
    };

    try {
      while (!done) {
        readingStream = true;
        const chunk = await reader.read();
        readingStream = false;
        bodyDone = chunk.done;
        if (!chunk.done) {
          request.resetIdleTimeout();
          await handlers.onActivity?.();
        }
        done = chunk.done;
        buffer += decoder.decode(chunk.value, { stream: !done });
        if (buffer.length > PROVIDER_SSE_BUFFER_MAX_BYTES) {
          throw new AiProviderInvalidResponseError(
            'AI provider stream buffer exceeded the limit',
          );
        }

        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          if (frame.length > PROVIDER_SSE_FRAME_MAX_BYTES) {
            throw new AiProviderInvalidResponseError(
              'AI provider SSE frame exceeded the limit',
            );
          }
          const parsed = await this.processSseFrame(frame, frameHandlers);
          if (parsed.done) {
            done = true;
            break;
          }
          if (parsed.usage) {
            usage = parsed.usage;
          }
        }
      }

      if (buffer.trim()) {
        if (buffer.length > PROVIDER_SSE_FRAME_MAX_BYTES) {
          throw new AiProviderInvalidResponseError(
            'AI provider SSE frame exceeded the limit',
          );
        }
        const parsed = await this.processSseFrame(buffer, frameHandlers);
        if (parsed.usage) {
          usage = parsed.usage;
        }
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        throw this.mapAbortError(request.getAbortReason());
      }
      if (readingStream) {
        throw new AiProviderInvalidResponseError(
          'AI provider stream disconnected',
        );
      }
      throw error;
    } finally {
      if (!bodyDone) {
        try {
          await reader.cancel();
        } catch {
          // The stream may already be errored by the abort signal.
        }
      }
      reader.releaseLock();
      request.cleanup();
    }

    await handlers.onUsage?.(usage);
    return usage;
  }

  private async processSseFrame(
    frame: string,
    handlers: {
      onText: (text: string) => Promise<void> | void;
    },
  ): Promise<{ done: boolean; usage?: AiProviderUsage }> {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();

    if (!data) {
      return { done: false };
    }
    if (data === '[DONE]') {
      return { done: true };
    }

    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new AiProviderInvalidResponseError(
        'AI provider returned malformed SSE data',
      );
    }

    const content = this.readMessageContent(
      payload?.choices?.[0]?.delta?.content,
    );
    if (content) {
      await handlers.onText(content);
    }

    return {
      done: false,
      usage: payload?.usage ? this.readUsage(payload.usage) : undefined,
    };
  }

  private readMessageContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map((part) =>
        part &&
        typeof part === 'object' &&
        (part as Record<string, unknown>).type === 'text' &&
        typeof (part as Record<string, unknown>).text === 'string'
          ? String((part as Record<string, unknown>).text)
          : '',
      )
      .join('');
  }

  private readUsage(value: any): AiProviderUsage {
    return {
      inputTokens: Math.max(
        0,
        Number(value?.prompt_tokens ?? value?.input_tokens ?? 0) || 0,
      ),
      outputTokens: Math.max(
        0,
        Number(value?.completion_tokens ?? value?.output_tokens ?? 0) || 0,
      ),
    };
  }

  private async requestJson<T>(
    config: Pick<AiProviderConfig, 'baseUrl' | 'apiKey' | 'requestTimeoutMs'>,
    path: string,
    init: RequestInit,
  ): Promise<ProviderResponse<T>> {
    const result = await this.openRequest(config, path, init);
    try {
      const body = await this.readLimitedBody(
        result.response,
        PROVIDER_JSON_MAX_BYTES,
      );
      return {
        response: result.response,
        data: JSON.parse(body) as T,
      };
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        throw this.mapAbortError(result.getAbortReason());
      }
      if (error instanceof AiProviderInvalidResponseError) {
        throw error;
      }
      throw new AiProviderInvalidResponseError(
        'AI provider returned invalid JSON',
      );
    } finally {
      result.cleanup();
    }
  }

  private async openRequest(
    config: Pick<AiProviderConfig, 'baseUrl' | 'apiKey' | 'requestTimeoutMs'>,
    path: string,
    init: RequestInit,
    streaming = false,
    isCancelled?: () => Promise<boolean> | boolean,
  ): Promise<{
    response: Response;
    getAbortReason: () => ProviderAbortReason | undefined;
    resetIdleTimeout: () => void;
    cleanup: () => void;
  }> {
    const controller = new AbortController();
    let abortReason: ProviderAbortReason | undefined;
    let cleanedUp = false;
    const abort = (reason: ProviderAbortReason) => {
      if (controller.signal.aborted) {
        return;
      }
      abortReason = reason;
      controller.abort();
    };
    const wholeRequestTimeout = setTimeout(
      () => abort('request_timeout'),
      config.requestTimeoutMs,
    );
    let cancelCheckInFlight = false;
    const pollCancellation = async () => {
      if (cancelCheckInFlight || controller.signal.aborted) {
        return;
      }
      cancelCheckInFlight = true;
      try {
        if (await isCancelled?.()) {
          abort('cancelled');
        }
      } catch {
        return;
      } finally {
        cancelCheckInFlight = false;
      }
    };
    const cancelPoll = isCancelled
      ? setInterval(() => void pollCancellation(), 500)
      : undefined;
    if (isCancelled) {
      void pollCancellation();
    }
    const abortBeforeFetch = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
    const streamIdleTimeoutMs = streaming
      ? Math.min(
          config.requestTimeoutMs,
          this.environmentService.getAiStreamIdleTimeoutMs(),
        )
      : undefined;
    let idleTimeout: NodeJS.Timeout | undefined;
    const resetIdleTimeout = () => {
      if (cleanedUp) {
        return;
      }
      if (idleTimeout) {
        clearTimeout(idleTimeout);
      }
      if (streamIdleTimeoutMs !== undefined) {
        idleTimeout = setTimeout(
          () => abort('stream_idle_timeout'),
          streamIdleTimeoutMs,
        );
      }
    };
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      clearTimeout(wholeRequestTimeout);
      if (cancelPoll) {
        clearInterval(cancelPoll);
      }
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = undefined;
      }
    };

    try {
      const baseUrl = await Promise.race([
        this.urlPolicy.assertAllowed(config.baseUrl),
        abortBeforeFetch,
      ]);
      const target = new URL(
        path.replace(/^\/+/, ''),
        `${baseUrl.toString().replace(/\/+$/, '')}/`,
      );
      if (controller.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      resetIdleTimeout();
      const response = await fetch(target, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: streaming ? 'text/event-stream' : 'application/json',
          'content-type': 'application/json',
          ...(config.apiKey
            ? { authorization: `Bearer ${config.apiKey}` }
            : {}),
          ...(init.headers ?? {}),
        },
      });

      if (response.status >= 300 && response.status < 400) {
        throw new BadGatewayException(
          'AI provider redirects are not permitted',
        );
      }

      if (!response.ok) {
        throw new BadGatewayException(
          `AI provider request failed (${response.status})`,
        );
      }

      return {
        response,
        getAbortReason: () => abortReason,
        resetIdleTimeout,
        cleanup,
      };
    } catch (error) {
      cleanup();
      if ((error as Error)?.name === 'AbortError') {
        throw this.mapAbortError(abortReason);
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadGatewayException('AI provider is unreachable');
    }
  }

  private mapAbortError(reason: ProviderAbortReason | undefined): Error {
    if (reason === 'cancelled') {
      return new AiProviderRequestCancelledError();
    }
    if (reason === 'stream_idle_timeout') {
      return new GatewayTimeoutException(
        'AI provider stream idle timeout exceeded',
      );
    }
    return new GatewayTimeoutException('AI provider request timed out');
  }

  private async readLimitedBody(
    response: Response,
    maxBytes: number,
  ): Promise<string> {
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > maxBytes) {
      throw new AiProviderInvalidResponseError(
        'AI provider response exceeded the size limit',
      );
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = '';
    let completed = false;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          completed = true;
          break;
        }
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) {
          throw new AiProviderInvalidResponseError(
            'AI provider response exceeded the size limit',
          );
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
      return body;
    } finally {
      if (!completed) {
        try {
          await reader.cancel();
        } catch {
          // The response may already be errored or aborted.
        }
      }
      reader.releaseLock();
    }
  }
}
