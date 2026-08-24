import type { FastifyReply, FastifyRequest } from 'fastify';

interface ExportRequestLifetime {
  signal: AbortSignal;
  attachToStream: (stream: NodeJS.ReadableStream) => void;
  cleanup: () => void;
}

export function createExportRequestLifetime(
  request?: FastifyRequest,
  reply?: FastifyReply,
): ExportRequestLifetime {
  const controller = new AbortController();
  const requestRaw = request?.raw;
  const replyRaw = reply?.raw;
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('Export HTTP connection was closed'));
    }
  };
  const abortIfReplyDidNotFinish = () => {
    if (!replyRaw?.writableEnded) abort();
  };
  const cleanup = () => {
    requestRaw?.removeListener('aborted', abort);
    replyRaw?.removeListener('close', abortIfReplyDidNotFinish);
  };

  requestRaw?.once('aborted', abort);
  replyRaw?.once('close', abortIfReplyDidNotFinish);

  return {
    signal: controller.signal,
    cleanup,
    attachToStream: (stream) => {
      const readable = stream as NodeJS.ReadableStream & {
        once?: (
          event: string,
          listener: (...args: unknown[]) => void,
        ) => unknown;
      };
      if (typeof readable.once !== 'function') {
        cleanup();
        return;
      }
      readable.once('end', cleanup);
      readable.once('error', cleanup);
      readable.once('close', cleanup);
    },
  };
}
