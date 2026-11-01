import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import {
  cp,
  mkdir,
  writeFile,
  appendFile,
  rm,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import { sanitizeLogText } from '../../../scripts/sanitize-ci-log-stream.mjs';
import {
  applicationAuditMode,
  applicationLogErrorSummary,
  createApplicationLogCapture,
} from '../../../scripts/ai-application-log-scan.mjs';
import {
  databaseQualityConfiguration,
  runDatabaseQuality,
  artifactHash,
} from './ai-database-quality-live.mjs';
import { createQualityProviderProxy } from './ai-quality-provider-proxy.mjs';
import {
  createQualityStaleIndex,
  runRagQuality,
} from './ai-rag-quality-live.mjs';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(repo, 'apps/server/package.json'));
const postgres = require('postgres');
const quality = databaseQualityConfiguration();
const release = process.argv.includes('--release');
const auditMode = applicationAuditMode(process.argv.slice(2));
const aiBrowserOnly = auditMode === 'ai-browser-only';
const editorBrowserOnly = auditMode === 'editor-browser-only';
if (auditMode && process.versions.node.split('.')[0] !== '22')
  throw new Error('Isolated release acceptance requires Node 22');
if (auditMode && quality)
  throw new Error(
    'Release acceptance and real-model quality capture use separate runtimes',
  );
const runId = randomUUID();
const prefix = `docmost-tables-live-${runId.slice(0, 8)}`;
const output = path.join(
  repo,
  'artifacts/database/live',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
const cwd = path.join(output, 'runtime/apps/server');
const children = [];
const applicationLogs = createApplicationLogCapture();
const containers = [];
let connection;
let networkCreated = false;
let providerCapture;
let staleIndex;
let qualityPreloadArgs = [];
const report = {
  runId,
  isolated: true,
  scope: quality
    ? `ai-${quality.scope}-quality`
    : aiBrowserOnly
      ? 'diagnostic-ai-browser'
      : editorBrowserOnly
        ? 'diagnostic-editor-browser'
        : release
          ? 'release'
          : process.argv.includes('--templates-only')
            ? 'targeted-templates'
            : process.argv.includes('--postgres-only')
              ? 'postgres'
              : process.argv.includes('--advanced-only')
                ? 'targeted-database-values'
                : process.argv.includes('--api-only')
                  ? 'api'
                  : process.argv.includes('--startup-only')
                    ? 'startup'
                    : 'full',
  tests: [],
  cleanup: {},
};
const exactSecrets = new Set();
const scrub = (text) => {
  for (const secret of exactSecrets)
    text = text.replaceAll(secret, '[REDACTED]');
  return sanitizeLogText(text);
};
const docker = async (args) =>
  (
    await exec('docker', args, { windowsHide: true, maxBuffer: 4_000_000 })
  ).stdout.trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
};
const start = (role, entry, env, args = []) => {
  const child = spawn(
    process.execPath,
    args.length ? [...args.slice(0, 2), entry, ...args.slice(2)] : [entry],
    {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let tail = '';
  const capture = (data, stream) => {
    if (role === 'api' || role === 'collaboration')
      applicationLogs.append(role, data, stream);
    tail = (tail + scrub(data.toString())).slice(-16_000);
  };
  child.stdout.on('data', (data) => capture(data, 'stdout'));
  child.stderr.on('data', (data) => capture(data, 'stderr'));
  children.push({ role, child, tail: () => tail });
  return child;
};
const wait = async (label, check, timeout = 120_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {
      /* Retry only readiness checks. */
    }
    const failed = children.find(({ child }) => child.exitCode !== null);
    if (failed)
      throw new Error(
        `${failed.role} exited during ${label}: ${failed.tail()}`,
      );
    await pause(500);
  }
  throw new Error(`Readiness timeout: ${label}`);
};

await mkdir(cwd, { recursive: true });
try {
  if (quality) {
    if (process.env.DOCMOST_QUALITY_GATEWAY_TOKEN)
      exactSecrets.add(process.env.DOCMOST_QUALITY_GATEWAY_TOKEN);
    const capturePath = path.join(output, 'quality-provider-requests.jsonl');
    await writeFile(capturePath, '');
    let captureWrites = Promise.resolve();
    providerCapture = await createQualityProviderProxy({
      upstream: quality.baseUrl,
      upstreamGatewayToken: process.env.DOCMOST_QUALITY_GATEWAY_TOKEN,
      model: quality.model,
      isolated: true,
      onCapture: (record) => {
        const next = captureWrites.then(() =>
          appendFile(capturePath, `${JSON.stringify(record)}\n`),
        );
        captureWrites = next.catch(() => {});
        return next;
      },
    });
    exactSecrets.add(providerCapture.token);
    if (quality.scope === 'rag') {
      staleIndex = await createQualityStaleIndex();
      exactSecrets.add(staleIndex.token);
      const filename = path.join(cwd, 'quality-capture.json');
      const captureOutput = path.join(output, 'quality-retrieval-trace.jsonl');
      await writeFile(captureOutput, '');
      await writeFile(
        filename,
        JSON.stringify({ isolated: true, output: captureOutput }),
      );
      qualityPreloadArgs = [
        '--require',
        path.join(repo, 'apps/server/test/ai-quality-retrieval-capture.cjs'),
        `--quality-capture-config=${filename}`,
      ];
    }
  }
  // Keep an immutable application snapshot while other checks rebuild the repo.
  const runtimeRoot = path.resolve(cwd, '..', '..');
  await cp(path.join(repo, 'apps/server/dist'), path.join(cwd, 'dist'), {
    recursive: true,
  });
  await cp(
    path.join(repo, 'apps/client/dist'),
    path.join(runtimeRoot, 'apps/client/dist'),
    { recursive: true },
  );
  await symlink(
    path.join(repo, 'apps/server/node_modules'),
    path.join(cwd, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  if (quality || auditMode) {
    const aliases = path.join(cwd, 'dist/node_modules/@docmost');
    await mkdir(aliases, { recursive: true });
    report.sharedArtifactSha256 = {};
    for (const name of ['api-contract', 'editor-ext']) {
      const source = path.join(repo, 'packages', name);
      const frozen = path.join(runtimeRoot, 'quality-shared', name);
      await mkdir(frozen, { recursive: true });
      await cp(
        path.join(source, 'package.json'),
        path.join(frozen, 'package.json'),
      );
      await cp(path.join(source, 'dist'), path.join(frozen, 'dist'), {
        recursive: true,
      });
      if (name === 'editor-ext')
        await symlink(
          path.join(source, 'node_modules'),
          path.join(frozen, 'node_modules'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      await symlink(
        frozen,
        path.join(aliases, name),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const resolved = createRequire(
        path.join(cwd, 'dist/apps/server/src/main.js'),
      ).resolve(`@docmost/${name}${name === 'editor-ext' ? '/server' : ''}`);
      if (!resolved.startsWith(frozen + path.sep))
        throw new Error('Shared package escaped its frozen runtime snapshot');
      report.sharedArtifactSha256[name] = await artifactHash(
        path.join(frozen, 'dist'),
      );
    }
  }
  report.immutableApplicationSnapshot = true;
  const subnet = process.argv
    .find((arg) => arg.startsWith('--subnet='))
    ?.slice('--subnet='.length);
  if (
    subnet &&
    !/^10\.(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.0\/28$/.test(
      subnet,
    )
  )
    throw new Error(
      'The isolated test subnet must be a private 10.x.x.0/28 range',
    );
  await docker([
    'network',
    'create',
    '--label',
    `docmost.database-test=${runId}`,
    ...(subnet ? ['--subnet', subnet] : []),
    prefix,
  ]);
  networkCreated = true;
  for (const [name, image, args] of [
    [
      `${prefix}-postgres`,
      'postgres:18@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636',
      [
        '-e',
        'POSTGRES_HOST_AUTH_METHOD=trust',
        '-e',
        'POSTGRES_DB=docmost_tables_live_test',
        '--tmpfs',
        '/var/lib/postgresql',
        '-p',
        '127.0.0.1::5432',
      ],
    ],
    [
      `${prefix}-redis`,
      'redis:8-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0',
      ['--tmpfs', '/data', '-p', '127.0.0.1::6379'],
    ],
  ]) {
    await docker([
      'run',
      '-d',
      '--name',
      name,
      '--network',
      prefix,
      '--label',
      `docmost.database-test=${runId}`,
      ...args,
      image,
    ]);
    containers.push(name);
    await writeFile(
      path.join(output, 'resources.json'),
      JSON.stringify(
        {
          runId,
          network: prefix,
          containers,
          synthetic: true,
        },
        null,
        2,
      ),
    );
  }
  const [pg, redis] = containers;
  await wait('PostgreSQL', async () => {
    await docker([
      'exec',
      pg,
      'pg_isready',
      '-U',
      'postgres',
      '-d',
      'docmost_tables_live_test',
    ]);
    return true;
  });
  await wait(
    'Redis',
    async () => (await docker(['exec', redis, 'redis-cli', 'ping'])) === 'PONG',
  );
  const binding = async (name, containerPort) =>
    Number((await docker(['port', name, containerPort])).split(':').at(-1));
  const apiPort = await port();
  const collabPort = await port();
  const modelPort = await port();
  const providerURL = `http://127.0.0.1:${modelPort}/v1`;
  const baseURL = `http://127.0.0.1:${apiPort}`;
  const collabURL = `http://127.0.0.1:${collabPort}`;
  const env = Object.fromEntries(
    ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  const appSecret = randomBytes(32).toString('hex');
  const collabSecret = randomBytes(32).toString('hex');
  exactSecrets.add(appSecret);
  exactSecrets.add(collabSecret);
  Object.assign(env, {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    APP_URL: baseURL,
    APP_SECRET: appSecret,
    DATABASE_URL: `postgresql://postgres@127.0.0.1:${await binding(pg, '5432')}/docmost_tables_live_test`,
    REDIS_URL: `redis://127.0.0.1:${await binding(redis, '6379')}`,
    COLLAB_PORT: String(collabPort),
    COLLAB_URL: collabURL,
    COLLAB_INTERNAL_URL: collabURL,
    COLLAB_INTERNAL_SECRET: collabSecret,
    COLLAB_SHOW_STATS: auditMode ? 'true' : 'false',
    AUTH_RATE_LIMIT_STORAGE: 'redis',
    DATABASE_MIGRATION_MODE: 'auto',
    MAIL_DRIVER: 'log',
    MAIL_FROM_ADDRESS: 'qa@example.test',
    SEARCH_DRIVER: 'database',
    STORAGE_DRIVER: 'local',
    PDF_CHROMIUM_EXECUTABLE_PATH: createRequire(
      path.join(repo, 'apps/client/package.json'),
    )('@playwright/test').chromium.executablePath(),
    RAG_SYNC_ENABLED: 'false',
    AI_EXTERNAL_MCP_ENABLED: 'false',
    AI_BUILTIN_TOOL_EXTENSIONS_ENABLED: 'true',
    AI_PROVIDER_ALLOWED_ORIGINS: [
      `http://127.0.0.1:${modelPort}`,
      quality?.origin,
      providerCapture?.origin,
      auditMode ? 'http://127.0.0.1:1080' : null,
    ]
      .filter(Boolean)
      .join(','),
    AI_RETRIEVAL_ALLOWED_ORIGINS: auditMode
      ? 'http://127.0.0.1:1080'
      : (staleIndex?.origin ?? ''),
    ...(auditMode ? { DRAWIO_URL: 'https://embed.diagrams.net' } : {}),
    PAGE_TEMPLATES_ENABLED: 'true',
    CLOUD: 'false',
    LOG_HTTP: 'false',
    DEBUG_DB: 'false',
    WEB_PUSH_ALLOWED_ORIGINS: '',
  });
  report.runtime = {
    baseURL,
    collabURL,
    postgres: '18',
    redis: '8',
    node: process.version,
    environmentFileLoaded: false,
  };
  console.log(
    'Starting isolated API and collaboration with real PostgreSQL and Redis.',
  );
  if (!quality && !auditMode) {
    env.INTEGRATION_PREVIEW_ALLOWED_ORIGINS =
      'https://api.github.com,https://gitlab.com,https://api.figma.com';
    qualityPreloadArgs = [
      '--require',
      path.join(repo, 'apps/server/test/integration-preview-fixture.cjs'),
      '--synthetic-integration-previews',
    ];
  }
  start(
    'ai-model',
    path.join(repo, 'apps/client/e2e/ai-agent/deterministic-agent-model.mjs'),
    {
      ...env,
      DOCMOST_AI_AGENT_MODEL_PORT: String(modelPort),
      DOCMOST_AI_AGENT_MODEL_HOST: '127.0.0.1',
    },
  );
  await wait(
    'deterministic AI provider',
    async () => (await fetch(`http://127.0.0.1:${modelPort}/health`)).ok,
  );
  start(
    'api',
    path.join(cwd, 'dist/apps/server/src/main.js'),
    env,
    qualityPreloadArgs,
  );
  await wait(
    'API and migrations',
    async () => (await fetch(`${baseURL}/api/health`)).ok,
  );
  start(
    'collaboration',
    path.join(cwd, 'dist/apps/server/src/collaboration/server/collab-main.js'),
    env,
  );
  await wait(
    'collaboration',
    async () => (await fetch(`${collabURL}/api/health`)).ok,
  );
  console.log(
    `Application ready at ${baseURL}; all migrations applied to the isolated database.`,
  );
  report.tests.push({
    name: 'API and collaboration readiness against PostgreSQL and Redis',
    passed: true,
  });
  if (
    !aiBrowserOnly &&
    !editorBrowserOnly &&
    !process.argv.includes('--startup-only') &&
    !process.argv.includes('--api-only') &&
    !process.argv.includes('--skip-postgres') &&
    !process.argv.includes('--mcp-oauth-only') &&
    !process.argv.includes('--integration-previews-only') &&
    !process.argv.includes('--upstream-repairs-only') &&
    !process.argv.includes('--templates-only') &&
    !process.argv.includes('--advanced-only') &&
    !quality
  ) {
    const jest = require.resolve('jest/bin/jest');
    const check = spawn(
      process.execPath,
      [
        jest,
        '--config',
        'test/jest-e2e.json',
        '--runInBand',
        'test/database-tables.e2e-spec.ts',
        'test/attachment-text-search.e2e-spec.ts',
      ],
      {
        cwd: path.join(repo, 'apps/server'),
        windowsHide: true,
        stdio: 'inherit',
        env: { ...env, DATABASE_TABLES_TEST_DATABASE_URL: env.DATABASE_URL },
      },
    );
    const [code] = await once(check, 'exit');
    if (code !== 0) throw new Error('PostgreSQL database acceptance failed');
    report.tests.push({
      name: 'PostgreSQL transactions, concurrency, query bounds, legacy archive and plain-text attachment acceptance',
      passed: true,
    });
  }
  if (
    !process.argv.includes('--startup-only') &&
    !process.argv.includes('--postgres-only')
  ) {
    connection = postgres(env.DATABASE_URL, { max: 4, onnotice: () => {} });
    const acceptance = auditMode
      ? (await import('./release-live-acceptance.mjs')).runReleaseAcceptance
      : quality
        ? quality.scope === 'rag'
          ? runRagQuality
          : runDatabaseQuality
        : (await import('./database-tables-live-acceptance.mjs'))
            .runLiveAcceptance;
    await acceptance({
      config: quality,
      providerCapture,
      staleIndex,
      providerURL,
      baseURL,
      collabURL,
      sql: connection,
      report,
      output,
      exactSecrets,
      auditMode,
      scanApplicationLogs: (patterns) => {
        for (const { value } of patterns) exactSecrets.add(value);
        return applicationLogs.scan([
          ...patterns,
          ...[...exactSecrets].filter(Boolean).map((value, index) => ({
            label: `root-secret-${index + 1}`,
            value,
          })),
        ]);
      },
    });
  }
  report.passed = quality ? null : true;
  if (quality) report.captureComplete = true;
} catch (error) {
  report.passed = false;
  report.error = scrub(error.message);
  const serverErrors = children
    .find((item) => item.role === 'api')
    ?.tail()
    .split('\n')
    .filter((line) => /ERROR|TypeError|Error:|at .*user/i.test(line));
  if (serverErrors?.length)
    console.error(applicationLogErrorSummary(serverErrors.slice(-14), scrub));
  console.error(report.error);
  for (const child of children.filter((item) =>
    ['api', 'collaboration'].includes(item.role),
  )) {
    await writeFile(
      path.join(output, `${child.role}-failure.log`),
      scrub(child.tail()),
    );
  }
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
  for (const { child } of children.reverse()) {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, 'exit'), pause(10_000)]);
      if (child.exitCode === null)
        await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
        }).catch(() => {});
    }
  }
  report.cleanup.processesStopped = true;
  applicationLogs.dispose();
  report.cleanup.applicationLogsDisposed = true;
  if (providerCapture) {
    try {
      await providerCapture.close();
      report.cleanup.providerCaptureClosed = true;
    } catch (error) {
      report.captureComplete = false;
      report.cleanup.providerCaptureClosed = false;
      report.error ??= scrub(error.message);
      process.exitCode = 1;
    }
  }
  if (staleIndex) await staleIndex.close();
  for (const name of containers.reverse()) await docker(['rm', '-f', name]);
  if (networkCreated) await docker(['network', 'rm', prefix]);
  report.cleanup.containersRemoved = true;
  const runtime = path.resolve(output, 'runtime');
  if (
    !runtime.startsWith(
      path.resolve(repo, 'artifacts/database/live') + path.sep,
    )
  )
    throw new Error('Unsafe runtime cleanup path');
  await rm(runtime, { recursive: true, force: true });
  report.cleanup.runtimeRemoved = true;
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `${quality && report.captureComplete ? 'Quality capture complete; acceptance and human review pending' : `Live acceptance ${report.passed ? 'passed' : 'failed'}`}; compact result: ${path.relative(repo, output)}/result.json`,
  );
}
