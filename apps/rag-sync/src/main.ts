import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { DocmostClient, OpenWebUiClient } from './clients.js';
import { RedisSyncStateStore } from './redis-state.js';
import { RagSynchronizer } from './synchronizer.js';
import { logCycleFailures } from './cycle-logging.js';

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
