import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeLogText } from '../../../scripts/sanitize-ci-log-stream.mjs';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(repo, 'apps/server/package.json'));
const postgres = require('postgres');
const runId = randomUUID();
const prefix = `docmost-tables-live-${runId.slice(0, 8)}`;
const output = path.join(
  repo,
  'artifacts/database/live',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
const cwd = path.join(output, 'runtime/apps/server');
const children = [];
const containers = [];
let connection;
let networkCreated = false;
const report = { runId, isolated: true, tests: [], cleanup: {} };
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
const start = (role, entry, env) => {
  const child = spawn(process.execPath, [entry], {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tail = '';
  const capture = (data) => {
    tail = (tail + scrub(data.toString())).slice(-16_000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
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
  await docker([
    'network',
    'create',
    '--label',
    `docmost.database-test=${runId}`,
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
    AUTH_RATE_LIMIT_STORAGE: 'redis',
    DATABASE_MIGRATION_MODE: 'auto',
    MAIL_DRIVER: 'log',
    MAIL_FROM_ADDRESS: 'qa@example.test',
    SEARCH_DRIVER: 'database',
    STORAGE_DRIVER: 'local',
    RAG_SYNC_ENABLED: 'false',
    AI_EXTERNAL_MCP_ENABLED: 'false',
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
  start(
    'api',
    path.join(repo, 'apps/server/dist/apps/server/src/main.js'),
    env,
  );
  await wait(
    'API and migrations',
    async () => (await fetch(`${baseURL}/api/health`)).ok,
  );
  start(
    'collaboration',
    path.join(
      repo,
      'apps/server/dist/apps/server/src/collaboration/server/collab-main.js',
    ),
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
    !process.argv.includes('--startup-only') &&
    !process.argv.includes('--api-only')
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
      name: 'PostgreSQL transactions, concurrency, query bounds and legacy archive acceptance',
      passed: true,
    });
  }
  if (!process.argv.includes('--startup-only')) {
    connection = postgres(env.DATABASE_URL, { max: 4, onnotice: () => {} });
    const { runLiveAcceptance } = await import(
      './database-tables-live-acceptance.mjs'
    );
    await runLiveAcceptance({
      baseURL,
      collabURL,
      sql: connection,
      report,
      output,
      exactSecrets,
    });
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = scrub(error.message);
  const serverErrors = children
    .find((item) => item.role === 'api')
    ?.tail()
    .split('\n')
    .filter((line) => /ERROR|TypeError|Error:|at .*user/i.test(line));
  if (serverErrors?.length) console.error(serverErrors.slice(-14).join('\n'));
  console.error(report.error);
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
    `Live acceptance ${report.passed ? 'passed' : 'failed'}; compact result: ${path.relative(repo, output)}/result.json`,
  );
}
