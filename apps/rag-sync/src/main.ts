import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { DocmostClient, OpenWebUiClient } from './clients.js';
import { RedisSyncStateStore } from './redis-state.js';
import { RagSynchronizer } from './synchronizer.js';
import { logCycleFailures } from './cycle-logging.js';
import type { RagSyncBinding } from './types.js';

for (const envPath of [
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'),
  resolve(process.cwd(), '.env'),
]) {
  if (existsSync(envPath)) {
    loadEnvFile(envPath);
    break;
  }
}

const { config, bindings } = loadConfig();
const state = new RedisSyncStateStore(config.redisUrl, config.redisPrefix);
const resolvedBindings = await Promise.all(
  bindings.map(async (bindingConfig) => {
    const docmost = new DocmostClient(bindingConfig, config.requestTimeoutMs);
    const scope = await docmost.getScope();
    if (!scope.syncTarget) {
      throw new Error(
        'The Docmost space selected by RAG_SYNC_DOCMOST_API_KEY has no Open WebUI Knowledge sync target; configure the open-webui-knowledge-v1 retrieval adapter in the space AI settings',
      );
    }
    const binding: RagSyncBinding = {
      ...bindingConfig,
      openWebUiBaseUrl: scope.syncTarget.baseUrl,
      knowledgeId: scope.syncTarget.knowledgeId,
    };
    return { binding, docmost };
  }),
);
const synchronizers = resolvedBindings.map(
  ({ binding, docmost }) =>
    new RagSynchronizer(
      binding,
      state,
      docmost,
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
    .then((results) => logCycleFailures(results))
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
