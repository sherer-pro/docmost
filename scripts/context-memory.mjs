import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:3111';
const AGENTMEMORY_VERSION = '0.9.29';
const III_VERSION = '0.11.2';
const PROVIDER_VARIABLES = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENROUTER_API_KEY',
  'MINIMAX_API_KEY',
  'FALLBACK_PROVIDERS',
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function commandResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function gitRoot() {
  const result = commandResult('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error('Current directory is not inside a Git repository.');
  }
  return resolve(result.stdout.trim());
}

function npmGlobalRoot() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'npm', 'node_modules');
  }
  const result = commandResult('npm', ['root', '-g']);
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error('Unable to resolve the global npm root.');
  }
  return resolve(result.stdout.trim());
}

function agentMemoryCli() {
  const configured = process.env.AGENTMEMORY_CLI_JS;
  const candidate = configured
    ? resolve(configured)
    : join(
        npmGlobalRoot(),
        '@agentmemory',
        'agentmemory',
        'dist',
        'cli.mjs',
      );
  if (!existsSync(candidate)) {
    throw new Error(
      `AgentMemory CLI was not found. Install @agentmemory/agentmemory@${AGENTMEMORY_VERSION} globally.`,
    );
  }
  return candidate;
}

function agentMemoryEnv() {
  const env = {
    ...process.env,
    AGENTMEMORY_PROVIDER: 'noop',
    OPENAI_API_KEY_FOR_LLM: 'false',
    EMBEDDING_PROVIDER: 'local',
    AGENTMEMORY_AUTO_COMPRESS: 'false',
    CONSOLIDATION_ENABLED: 'false',
    GRAPH_EXTRACTION_ENABLED: 'true',
    AGENTMEMORY_ALLOW_AGENT_SDK: 'false',
    AGENTMEMORY_INJECT_CONTEXT: 'false',
    AGENTMEMORY_TOOLS: 'core',
    TOKEN_BUDGET: '1000',
    AGENTMEMORY_URL: DEFAULT_URL,
    III_REST_PORT: '3111',
    III_STREAM_PORT: '3112',
    III_VIEWER_PORT: '3113',
    III_ENGINE_PORT: '49134',
    AGENTMEMORY_VIEWER_HOST: '127.0.0.1',
    AGENTMEMORY_III_VERSION: III_VERSION,
  };
  for (const name of PROVIDER_VARIABLES) {
    delete env[name];
  }
  const privateBin = join(homedir(), '.agentmemory', 'bin');
  const pathKey = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = `${privateBin}${delimiter}${env[pathKey] ?? ''}`;
  return env;
}

function graphifyEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      name.startsWith('AGENTMEMORY_') ||
      [
        'EMBEDDING_PROVIDER',
        'CONSOLIDATION_ENABLED',
        'GRAPH_EXTRACTION_ENABLED',
        'TOKEN_BUDGET',
      ].includes(name)
    ) {
      delete env[name];
    }
  }
  return env;
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AGENTMEMORY_SECRET) {
    headers.Authorization = `Bearer ${process.env.AGENTMEMORY_SECRET}`;
  }
  return headers;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${DEFAULT_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
  });
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} failed with HTTP ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    );
  }
  return body;
}

async function isHealthy() {
  try {
    const body = await fetchJson('/agentmemory/health');
    return (
      body?.status === 'ok' ||
      body?.status === 'healthy' ||
      body?.health?.status === 'healthy' ||
      body?.healthy === true ||
      body?.success === true
    );
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await sleep(750);
  }
  return false;
}

function runCli(args) {
  const result = commandResult(process.execPath, [agentMemoryCli(), ...args], {
    cwd: homedir(),
    env: agentMemoryEnv(),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
  return result.status ?? 1;
}

function dockerEngineContainers() {
  const result = commandResult(
    'docker',
    [
      'ps',
      '--filter',
      'publish=3111',
      '--format',
      '{{.ID}}\t{{.Image}}\t{{.Names}}',
    ],
    { env: process.env },
  );
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([, image]) => image?.startsWith('iiidev/iii:'));
}

function enforceNoAutostart() {
  const containers = dockerEngineContainers();
  if (containers.length === 0) {
    console.log('iii-engine is using the native user-level runtime; no OS startup entry was created.');
    return;
  }
  if (containers.length !== 1) {
    throw new Error(
      `Expected one AgentMemory iii-engine container on port 3111, found ${containers.length}.`,
    );
  }
  const [id, image, name] = containers[0];
  const update = commandResult('docker', ['update', '--restart=no', id], {
    stdio: 'inherit',
  });
  if (update.status !== 0) {
    throw new Error('Unable to disable the iii-engine Docker restart policy.');
  }
  const inspect = commandResult(
    'docker',
    ['inspect', '--format', '{{.HostConfig.RestartPolicy.Name}}', id],
  );
  if (inspect.status !== 0 || inspect.stdout.trim() !== 'no') {
    throw new Error('The iii-engine Docker restart policy is not disabled.');
  }
  console.log(`iii-engine ${image} is running as ${name}; restart policy: no.`);
}

async function start() {
  if (await isHealthy()) {
    console.log(`AgentMemory is already healthy at ${DEFAULT_URL}.`);
    enforceNoAutostart();
    return;
  }

  const logDir = join(homedir(), '.agentmemory', 'logs');
  mkdirSync(logDir, { recursive: true });
  const stdoutPath = join(logDir, 'agentmemory.stdout.log');
  const stderrPath = join(logDir, 'agentmemory.stderr.log');
  const stdoutFd = openSync(stdoutPath, 'a');
  const stderrFd = openSync(stderrPath, 'a');
  const child = spawn(process.execPath, [agentMemoryCli()], {
    cwd: homedir(),
    detached: true,
    env: agentMemoryEnv(),
    stdio: ['ignore', stdoutFd, stderrFd],
    windowsHide: true,
  });
  child.unref();
  closeSync(stdoutFd);
  closeSync(stderrFd);

  if (!(await waitForHealth(120_000))) {
    throw new Error(
      `AgentMemory did not become healthy. Inspect ${stdoutPath} and ${stderrPath}.`,
    );
  }
  enforceNoAutostart();
  console.log(`AgentMemory is healthy at ${DEFAULT_URL}.`);
  console.log(`Logs: ${logDir}`);
}

async function stop() {
  if (!(await isHealthy())) {
    console.log('AgentMemory is already stopped.');
    return;
  }
  const status = runCli(['stop']);
  if (status !== 0) return;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && (await isHealthy())) {
    await sleep(500);
  }
  if (await isHealthy()) {
    throw new Error('AgentMemory health endpoint is still reachable after stop.');
  }
  console.log('AgentMemory stopped.');
}

function validateGraph(root) {
  const path = join(root, 'graphify-out', 'graph.json');
  if (!existsSync(path)) {
    throw new Error(`Graphify graph is missing: ${path}`);
  }
  let graph;
  try {
    graph = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Graphify graph is not valid JSON: ${error.message}`);
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.links)
    ? graph.links
    : Array.isArray(graph.edges)
      ? graph.edges
      : [];
  if (nodes.length === 0 || edges.length === 0) {
    throw new Error(
      `Graphify graph must contain nodes and edges; found ${nodes.length} nodes and ${edges.length} edges.`,
    );
  }
  return { path, nodes: nodes.length, edges: edges.length };
}

async function importGraph() {
  if (!(await isHealthy())) {
    throw new Error(
      `AgentMemory is not healthy at ${DEFAULT_URL}. Run context:memory:start first.`,
    );
  }
  const root = gitRoot();
  const source = validateGraph(root);
  console.log(
    `Validated graphify-out/graph.json: ${source.nodes} nodes, ${source.edges} edges.`,
  );
  const result = await fetchJson('/agentmemory/graph/import-graphify', {
    method: 'POST',
    body: JSON.stringify({ cwd: root }),
  });
  if (!result?.success) {
    throw new Error(`Graphify import failed: ${result?.error ?? 'unknown error'}`);
  }
  console.log(
    `Graphify import: ${result.nodesImported ?? 0} nodes, ${result.edgesImported ?? 0} edges; new: ${result.newNodes ?? 0} nodes, ${result.newEdges ?? 0} edges.`,
  );
  if (result.truncated) {
    console.warn(
      `Import truncated by AgentMemory limits: ${result.truncated.nodes ?? 0} nodes and ${result.truncated.edges ?? 0} edges were outside the import cap.`,
    );
  }
  if (result.skippedEdges) {
    console.warn(`Import skipped ${result.skippedEdges} edges.`);
  }
  return result;
}

async function refresh({ dryRun }) {
  const root = gitRoot();
  const source = validateGraph(root);
  if (dryRun) {
    console.log(
      `Dry run: graphify update . in ${basename(root)}, then validate and import ${source.nodes} current nodes / ${source.edges} current edges.`,
    );
    return;
  }

  const backupKey = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const backupDir = join(
    homedir(),
    '.agentmemory',
    'graphify-backups',
    backupKey,
  );
  mkdirSync(backupDir, { recursive: true });
  const backup = join(backupDir, 'graph.json.before-refresh');
  copyFileSync(source.path, backup);

  const result = commandResult('graphify', ['update', '.'], {
    cwd: root,
    env: graphifyEnv(),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    copyFileSync(backup, source.path);
    throw new Error(
      `graphify update failed with exit code ${result.status}; the previous valid graph.json was restored.`,
    );
  }
  validateGraph(root);
  await importGraph();
}

function usage() {
  console.log(`Usage: node scripts/context-memory.mjs <command>

Commands:
  start                 Start AgentMemory on loopback only
  stop                  Stop AgentMemory
  status                Show AgentMemory status
  doctor                Run non-mutating AgentMemory diagnostics
  graph-import          Import the existing Graphify graph
  refresh [--dry-run]   Run graphify update ., then import on success`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'start':
      await start();
      break;
    case 'stop':
      await stop();
      break;
    case 'status':
      runCli(['status']);
      break;
    case 'doctor':
      runCli(['doctor', '--dry-run']);
      break;
    case 'graph-import':
      await importGraph();
      break;
    case 'refresh':
      await refresh({ dryRun: args.includes('--dry-run') });
      break;
    default:
      usage();
      if (command) process.exitCode = 1;
  }
}

const isEntryPoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntryPoint) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
