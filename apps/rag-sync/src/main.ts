import { loadConfig } from './config.js';
import { DocmostClient, OpenWebUiClient } from './clients.js';
import { RedisSyncStateStore } from './redis-state.js';
import { RagSynchronizer } from './synchronizer.js';

const configPath = process.env.RAG_SYNC_CONFIG_PATH;
if (!configPath) {
  throw new Error('RAG_SYNC_CONFIG_PATH is required');
}

const { config, bindings } = await loadConfig(configPath);
const state = new RedisSyncStateStore(config.redisUrl, config.redisPrefix);
const synchronizers = bindings.map(
  (binding) =>
    new RagSynchronizer(
      binding,
      state,
      new DocmostClient(binding, config.requestTimeoutMs),
      new OpenWebUiClient(
        binding,
        config.requestTimeoutMs,
        config.processingTimeoutMs,
      ),
      config.maxAttachmentBytes,
      config.pollIntervalMs,
    ),
);

let stopped = false;
let cycle: Promise<void> | null = null;

async function runCycle(): Promise<void> {
  if (cycle || stopped) return;
  cycle = Promise.allSettled(
    synchronizers.map((synchronizer) => synchronizer.syncOnce()),
  )
    .then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(
            JSON.stringify({
              component: 'rag-sync',
              event: 'sync.failed',
              bindingId: bindings[index]?.id,
              errorCode: errorCode(result.reason),
            }),
          );
        }
      });
    })
    .finally(() => {
      cycle = null;
    });
  await cycle;
}

const interval = setInterval(() => void runCycle(), config.pollIntervalMs);

async function shutdown(): Promise<void> {
  if (stopped) return;
  stopped = true;
  clearInterval(interval);
  await cycle;
  await state.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await runCycle();

function errorCode(error: unknown): string {
  const status = Number((error as { status?: unknown })?.status);
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'remote_unavailable';
  if ((error as Error)?.name === 'AbortError') return 'timeout';
  return 'sync_failed';
}
