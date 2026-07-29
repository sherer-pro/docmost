import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { loadConfig } from './config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe('loadConfig', () => {
  it('loads credentials only from secret files', async () => {
    const directory = await makeDirectory();
    await writeFile(join(directory, 'docmost.key'), 'docmost-secret\n');
    await writeFile(join(directory, 'open-webui.key'), 'writer-secret\n');
    const configPath = join(directory, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        redisUrl: 'redis://localhost:6379/1',
        bindings: [
          {
            id: 'space-a',
            workspaceId: '0198f2f5-a5a3-7000-8000-000000000001',
            spaceId: '0198f2f5-a5a3-7000-8000-000000000002',
            docmostBaseUrl: 'https://docmost.example',
            docmostApiKeyFile: './docmost.key',
            openWebUiBaseUrl: 'https://open-webui.example',
            openWebUiApiKeyFile: './open-webui.key',
            knowledgeId: 'knowledge-1',
          },
        ],
      }),
    );

    const result = await loadConfig(configPath);

    assert.equal(result.bindings[0]?.docmostApiKey, 'docmost-secret');
    assert.equal(result.bindings[0]?.openWebUiApiKey, 'writer-secret');
    assert.equal(result.config.pollIntervalMs, 60_000);
    assert.equal(result.config.maxAttachmentBytes, 25 * 1024 * 1024);
  });

  it('rejects inline keys and non-origin Open WebUI URLs', async () => {
    const directory = await makeDirectory();
    const configPath = join(directory, 'config.json');
    const baseBinding = {
      id: 'space-a',
      workspaceId: '0198f2f5-a5a3-7000-8000-000000000001',
      spaceId: '0198f2f5-a5a3-7000-8000-000000000002',
      docmostBaseUrl: 'https://docmost.example',
      docmostApiKeyFile: './docmost.key',
      openWebUiBaseUrl: 'https://open-webui.example/api',
      openWebUiApiKeyFile: './open-webui.key',
      knowledgeId: 'knowledge-1',
    };
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        redisUrl: 'redis://localhost:6379/1',
        bindings: [{ ...baseBinding, openWebUiApiKey: 'inline-secret' }],
      }),
    );

    await assert.rejects(loadConfig(configPath), /inline keys/);

    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        redisUrl: 'redis://localhost:6379/1',
        bindings: [baseBinding],
      }),
    );
    await assert.rejects(loadConfig(configPath), /HTTP\(S\) origins/);
  });
});

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'docmost-rag-sync-'));
  temporaryDirectories.push(directory);
  return directory;
}
