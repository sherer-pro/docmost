import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTMEMORY_VERSION = '0.9.29';
const MCP_SHIM_VERSION = '0.9.28';
const III_VERSION = '0.11.2';
const EXPECTED_PROFILE = {
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
  III_REST_PORT: '3111',
  III_STREAM_PORT: '3112',
  III_VIEWER_PORT: '3113',
  III_ENGINE_PORT: '49134',
  AGENTMEMORY_VIEWER_HOST: '127.0.0.1',
  AGENTMEMORY_III_VERSION: III_VERSION,
  AGENTMEMORY_DATA_DIR: '~/.agentmemory/data',
};
const PROVIDER_KEY_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'COHERE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'MINIMAX_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'VOYAGE_API_KEY',
];
const PROVIDER_VARIABLES = [
  ...PROVIDER_KEY_VARIABLES,
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'FALLBACK_PROVIDERS',
];
const GRAPHIFY_ENV_VARIABLES = [
  'EMBEDDING_PROVIDER',
  'CONSOLIDATION_ENABLED',
  'GRAPH_EXTRACTION_ENABLED',
  'TOKEN_BUDGET',
  'III_REST_PORT',
  'III_STREAM_PORT',
  'III_VIEWER_PORT',
  'III_ENGINE_PORT',
  'OPENAI_API_KEY_FOR_LLM',
];
const REQUIRED_AGENTMEMORY_HOOKS = {
  SessionStart: 'session-start.mjs',
  UserPromptSubmit: 'prompt-submit.mjs',
  PreToolUse: 'pre-tool-use.mjs',
  PostToolUse: 'post-tool-use.mjs',
  PreCompact: 'pre-compact.mjs',
  Stop: 'stop.mjs',
};

let activeProfile;

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

function expandHome(path) {
  const value = String(path ?? '').trim();
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function isPathInside(parent, candidate) {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return (
    pathFromParent === '' ||
    (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent))
  );
}

function npmGlobalRoot() {
  const npmCommand =
    process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const npmArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm.cmd root -g']
      : ['root', '-g'];
  try {
    const result = commandResult(npmCommand, npmArgs);
    if (result.status === 0 && result.stdout.trim()) {
      return resolve(result.stdout.trim());
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'EINVAL') throw error;
  }

  if (process.env.npm_config_prefix) {
    const prefix = resolve(expandHome(process.env.npm_config_prefix));
    return process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'npm', 'node_modules');
  }
  throw new Error('Unable to resolve the global npm root.');
}

function agentMemoryPackageRoot() {
  return join(npmGlobalRoot(), '@agentmemory', 'agentmemory');
}

function agentMemoryCli() {
  const configured = process.env.AGENTMEMORY_CLI_JS;
  const candidate = configured
    ? resolve(expandHome(configured))
    : join(agentMemoryPackageRoot(), 'dist', 'cli.mjs');
  if (!existsSync(candidate)) {
    throw new Error(
      `AgentMemory CLI was not found. Install @agentmemory/agentmemory@${AGENTMEMORY_VERSION} globally.`,
    );
  }
  return candidate;
}

function profilePath() {
  return join(homedir(), '.agentmemory', '.env');
}

function parseEnvFile(path) {
  if (!existsSync(path)) {
    throw new Error(`AgentMemory profile is missing: ${path}`);
  }
  const values = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function validateLoopbackHttpUrl(value, source) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${source} must be a valid URL.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${source} must be a loopback HTTP origin without credentials or a path.`);
  }
  return parsed.origin;
}

function validateProfile(root = gitRoot()) {
  const path = profilePath();
  const values = parseEnvFile(path);
  const problems = [];
  const warnings = [];

  const configuredKeys = PROVIDER_KEY_VARIABLES.filter((name) =>
    Object.hasOwn(values, name),
  );
  if (configuredKeys.length > 0) {
    problems.push(`provider keys are not allowed in ${path}: ${configuredKeys.join(', ')}`);
  }
  if (values.AGENTMEMORY_PROVIDER !== 'noop') {
    problems.push('AGENTMEMORY_PROVIDER must be noop.');
  }

  let fileUrl;
  try {
    fileUrl = validateLoopbackHttpUrl(
      values.AGENTMEMORY_URL ?? '',
      `${path} AGENTMEMORY_URL`,
    );
  } catch (error) {
    problems.push(error.message);
  }

  let url = fileUrl;
  const override = process.env.AGENTMEMORY_URL;
  if (override) {
    try {
      url = validateLoopbackHttpUrl(override, 'environment AGENTMEMORY_URL');
    } catch (error) {
      problems.push(error.message);
    }
  }

  if (!values.AGENTMEMORY_DATA_DIR) {
    problems.push('AGENTMEMORY_DATA_DIR must be set.');
  }
  const configuredDataDir = values.AGENTMEMORY_DATA_DIR
    ? resolve(expandHome(values.AGENTMEMORY_DATA_DIR))
    : null;
  const dataDir =
    configuredDataDir && existsSync(configuredDataDir)
      ? realpathSync(configuredDataDir)
      : configuredDataDir;
  if (dataDir && isPathInside(root, dataDir)) {
    problems.push(`AGENTMEMORY_DATA_DIR must be outside the repository: ${dataDir}`);
  }

  for (const [name, expected] of Object.entries(EXPECTED_PROFILE)) {
    if (['AGENTMEMORY_PROVIDER', 'AGENTMEMORY_URL', 'AGENTMEMORY_DATA_DIR'].includes(name)) continue;
    if (values[name] !== expected) {
      warnings.push(`${name}=${values[name] === undefined ? '<unset>' : '<different>'}; expected ${expected}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Unsafe AgentMemory profile:\n- ${problems.join('\n- ')}`);
  }
  for (const warning of warnings) {
    console.warn(`Profile warning: ${warning}`);
  }

  return { path, values, url, dataDir, warnings };
}

function currentProfile(root = gitRoot()) {
  if (!activeProfile) activeProfile = validateProfile(root);
  return activeProfile;
}

function agentMemoryUrl() {
  return currentProfile().url;
}

function agentMemoryEnv(root = gitRoot()) {
  const profile = currentProfile(root);
  const env = {
    ...process.env,
    ...profile.values,
    ...EXPECTED_PROFILE,
    AGENTMEMORY_URL: profile.url,
    AGENTMEMORY_DATA_DIR: profile.dataDir,
  };
  for (const name of PROVIDER_VARIABLES) {
    delete env[name];
  }
  const privateBin = join(homedir(), '.agentmemory', 'bin');
  const pathKey = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
  const currentPath = env[pathKey] ?? '';
  for (const name of Object.keys(env)) {
    if (name.toLowerCase() === 'path') delete env[name];
  }
  env[process.platform === 'win32' ? 'Path' : 'PATH'] = `${privateBin}${delimiter}${currentPath}`;
  return env;
}

function graphifyEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('AGENTMEMORY_') || GRAPHIFY_ENV_VARIABLES.includes(name)) {
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
  const response = await fetch(`${agentMemoryUrl()}${path}`, {
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
      `${options.method ?? 'GET'} ${path} failed with HTTP ${response.status}.`,
    );
  }
  return body;
}

function healthIsHealthy(body) {
  return (
    body?.status === 'ok' ||
    body?.status === 'healthy' ||
    body?.health?.status === 'healthy' ||
    body?.healthy === true ||
    body?.success === true
  );
}

async function isHealthy() {
  try {
    return healthIsHealthy(await fetchJson('/agentmemory/health'));
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

async function waitForStableHealth(timeoutMs, stableMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  while (Date.now() < deadline) {
    if (await isHealthy()) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= stableMs) return true;
    } else {
      stableSince = null;
    }
    await sleep(500);
  }
  return false;
}

function healthWorker(body) {
  const workers = Array.isArray(body?.health?.workers) ? body.health.workers : [];
  return workers.find((entry) => entry?.name === 'agentmemory') ?? workers[0];
}

async function fetchHealthWithWorker(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastHealth;
  while (Date.now() < deadline) {
    try {
      lastHealth = await fetchJson('/agentmemory/health');
      if (healthIsHealthy(lastHealth) && healthWorker(lastHealth)) return lastHealth;
    } catch {
      // Retry while the shared service reconnects its worker.
    }
    await sleep(500);
  }
  return lastHealth;
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
  let result;
  try {
    result = commandResult(
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
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([, image]) => image?.startsWith('iiidev/iii:'));
}

function enforceNoAutostart() {
  const containers = dockerEngineContainers();
  if (containers === null) {
    console.warn('Docker is unavailable; the iii-engine container restart-policy check was skipped.');
    return;
  }
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
  const update = commandResult('docker', ['update', '--restart=no', id], { stdio: 'inherit' });
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
  const profile = currentProfile();
  if (await isHealthy()) {
    console.log(`AgentMemory is already healthy at ${profile.url}.`);
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
    throw new Error(`AgentMemory did not become healthy. Inspect ${stdoutPath} and ${stderrPath}.`);
  }
  enforceNoAutostart();
  console.log(`AgentMemory is healthy at ${profile.url}.`);
  console.log(`Logs: ${logDir}`);
}

async function stop() {
  currentProfile();
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
  console.log('AgentMemory stopped for every repository using this shared machine service.');
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

async function importGraphOnce(root) {
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
  if (result.skippedEdges) console.warn(`Import skipped ${result.skippedEdges} edges.`);
  return result;
}

async function importGraph({ assertIdempotent = false } = {}) {
  currentProfile();
  if (!(await isHealthy())) {
    throw new Error(
      `AgentMemory is not healthy at ${agentMemoryUrl()}. Run context:memory:start first.`,
    );
  }
  const root = gitRoot();
  const source = validateGraph(root);
  console.log(
    `Validated graphify-out/graph.json: ${source.nodes} nodes, ${source.edges} edges.`,
  );
  const result = await importGraphOnce(root);
  if (!(await waitForStableHealth(60_000))) {
    throw new Error('AgentMemory did not become stably healthy after the import.');
  }
  if (assertIdempotent) {
    const repeated = await importGraphOnce(root);
    if ((repeated.newNodes ?? 0) !== 0 || (repeated.newEdges ?? 0) !== 0) {
      throw new Error(
        `Repeated Graphify import was not idempotent: ${repeated.newNodes ?? 0} new nodes and ${repeated.newEdges ?? 0} new edges.`,
      );
    }
    if (!(await waitForStableHealth(60_000))) {
      throw new Error('AgentMemory did not become stably healthy after the repeated import.');
    }
    console.log('Repeated Graphify import is idempotent: 0 new nodes, 0 new edges.');
  }
  return result;
}

function trackedGraphifyArtifacts(root) {
  const result = commandResult('git', ['ls-files', '-z', '--', 'graphify-out'], { cwd: root });
  if (result.status !== 0) {
    throw new Error('Unable to enumerate tracked graphify-out artifacts.');
  }
  const files = result.stdout.split('\0').filter(Boolean);
  if (!files.includes('graphify-out/graph.json')) {
    throw new Error('Tracked graphify-out/graph.json is required for refresh backups.');
  }
  for (const relativePath of files) {
    const source = resolve(root, relativePath);
    if (!isPathInside(join(root, 'graphify-out'), source) || !existsSync(source)) {
      throw new Error(`Tracked Graphify artifact is missing or outside graphify-out: ${relativePath}`);
    }
  }
  return files;
}

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertSafeBackupDirectory(parent, target) {
  const resolvedParent = realpathSync(parent);
  const resolvedTarget = realpathSync(target);
  if (
    resolvedTarget === resolvedParent ||
    !isPathInside(resolvedParent, resolvedTarget) ||
    lstatSync(target).isSymbolicLink()
  ) {
    throw new Error(`Refusing to use an unsafe Graphify backup path: ${resolvedTarget}`);
  }
  return { resolvedParent, resolvedTarget };
}

function createGraphifyBackup(root, files) {
  const backupKey = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const backupParent = join(homedir(), '.agentmemory', 'graphify-backups', backupKey);
  mkdirSync(backupParent, { recursive: true });
  const backupDir = join(backupParent, 'before-refresh');
  if (!isPathInside(backupParent, backupDir)) {
    throw new Error(`Refusing to use an unsafe Graphify backup path: ${backupDir}`);
  }
  if (existsSync(backupDir)) {
    const checked = assertSafeBackupDirectory(backupParent, backupDir);
    const matchesCurrent = files.every((relativePath) => {
      const backupPath = join(backupDir, relativePath);
      return (
        existsSync(backupPath) &&
        fileHash(backupPath) === fileHash(join(root, relativePath))
      );
    });
    if (!matchesCurrent) {
      throw new Error(
        `A retained Graphify backup differs from the current tracked artifacts: ${checked.resolvedTarget}. Inspect it before another refresh.`,
      );
    }
    return { backupParent: checked.resolvedParent, backupDir: checked.resolvedTarget };
  }
  mkdirSync(backupDir, { recursive: false });
  for (const relativePath of files) {
    const target = join(backupDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, relativePath), target);
  }
  return { backupParent: realpathSync(backupParent), backupDir: realpathSync(backupDir) };
}

function restoreGraphifyBackup(root, files, backupDir) {
  for (const relativePath of files) {
    const source = join(backupDir, relativePath);
    if (!existsSync(source)) {
      throw new Error(`Graphify backup is incomplete: ${source}`);
    }
    copyFileSync(source, join(root, relativePath));
  }
}

function removeGraphifyBackup(backup) {
  const checked = assertSafeBackupDirectory(backup.backupParent, backup.backupDir);
  rmSync(checked.resolvedTarget, { recursive: true, force: false });
}

async function refresh({ dryRun }) {
  currentProfile();
  const root = gitRoot();
  const source = validateGraph(root);
  const files = trackedGraphifyArtifacts(root);
  if (dryRun) {
    console.log(
      `Dry run: back up ${files.length} tracked graphify-out artifacts, run graphify update . in ${basename(root)}, then validate and import ${source.nodes} current nodes / ${source.edges} current edges.`,
    );
    return;
  }

  const backup = createGraphifyBackup(root, files);
  try {
    const result = commandResult('graphify', ['update', '.'], {
      cwd: root,
      env: graphifyEnv(),
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(
        `graphify update failed with exit code ${result.status}.`,
      );
    }
    validateGraph(root);
    await importGraph();
    removeGraphifyBackup(backup);
  } catch (error) {
    if (existsSync(backup.backupDir)) {
      restoreGraphifyBackup(root, files, backup.backupDir);
    }
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} All ${files.length} tracked Graphify artifacts were restored; the backup was retained at ${backup.backupDir}.`,
    );
  }
}

function inspectJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, output));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectStrings(entry, output));
  }
  return output;
}

function hookCommands(hooksDocument, event) {
  const groups = Array.isArray(hooksDocument?.hooks?.[event]) ? hooksDocument.hooks[event] : [];
  return groups.flatMap((group) =>
    (Array.isArray(group?.hooks) ? group.hooks : [])
      .map((hook) => hook?.command)
      .filter((command) => typeof command === 'string'),
  );
}

function commandScriptPath(command) {
  const quoted = command.match(/["']([^"']+\.mjs)["']/iu);
  if (quoted) return quoted[1];
  const unquoted = command.match(/(?:^|\s)([^\s]+\.mjs)(?:\s|$)/iu);
  return unquoted?.[1] ?? null;
}

function windowsPortListeners(port) {
  const result = commandResult('powershell', [
    '-NoProfile',
    '-Command',
    `$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen -LocalPort ${port} | ForEach-Object { $_.LocalAddress }) | ConvertTo-Json -Compress`,
  ]);
  if (result.status !== 0) throw new Error(`Unable to inspect TCP listeners on port ${port}.`);
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

function unixPortListeners(port) {
  const result = commandResult('ss', ['-ltnH', `sport = :${port}`]);
  if (result.status !== 0) throw new Error(`Unable to inspect TCP listeners on port ${port}.`);
  return result.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/u).at(-2)?.replace(/:\d+$/u, ''))
    .filter(Boolean);
}

function portListeners(port) {
  return process.platform === 'win32' ? windowsPortListeners(port) : unixPortListeners(port);
}

function runMcpSmoke() {
  const result = commandResult(process.execPath, ['scripts/agentmemory-mcp-smoke.mjs'], {
    cwd: gitRoot(),
    env: { ...process.env, AGENTMEMORY_URL: agentMemoryUrl() },
  });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  if (result.status !== 0) throw new Error('Run: corepack pnpm context:memory:smoke');
}

async function verify() {
  const root = gitRoot();
  const profile = currentProfile(root);
  const failures = [];
  const checks = [];
  const check = (name, ok, recovery, detail) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
    if (!ok) failures.push({ name, recovery });
  };

  let health;
  try {
    health = await fetchHealthWithWorker(30_000);
  } catch (error) {
    check('AgentMemory health and versions', false, 'corepack pnpm context:memory:start', error.message);
  }
  if (health) {
    const worker = healthWorker(health);
    check(
      'AgentMemory health and versions',
      healthIsHealthy(health) && health.version === AGENTMEMORY_VERSION && worker?.version === III_VERSION,
      'corepack pnpm context:memory:start',
      `server=${health.version ?? '<unknown>'}, worker=${worker?.version ?? '<unknown>'}, status=${health.status ?? '<unknown>'}`,
    );
  }

  const safeProfile = Object.entries(EXPECTED_PROFILE).every(([name, expected]) => {
    if (name === 'AGENTMEMORY_URL') return profile.url === validateLoopbackHttpUrl(profile.url, name);
    if (name === 'AGENTMEMORY_DATA_DIR') return profile.dataDir && !isPathInside(root, profile.dataDir);
    return profile.values[name] === expected;
  });
  check(
    'Safe AgentMemory profile',
    safeProfile && profile.warnings.length === 0,
    `copy docs/development/agentmemory.env.example to ${profile.path} and restart AgentMemory`,
    `provider=${profile.values.AGENTMEMORY_PROVIDER}, embeddings=${profile.values.EMBEDDING_PROVIDER}, graph=${profile.values.GRAPH_EXTRACTION_ENABLED}, auto-compress=${profile.values.AGENTMEMORY_AUTO_COMPRESS}, consolidation=${profile.values.CONSOLIDATION_ENABLED}, inject=${profile.values.AGENTMEMORY_INJECT_CONTEXT}`,
  );

  for (const name of ['III_REST_PORT', 'III_STREAM_PORT', 'III_VIEWER_PORT', 'III_ENGINE_PORT']) {
    const port = Number(profile.values[name]);
    let listeners = [];
    try {
      listeners = portListeners(port);
    } catch (error) {
      check(`Loopback listener ${name}`, false, 'corepack pnpm context:memory:start', error.message);
      continue;
    }
    check(
      `Loopback listener ${name}`,
      listeners.length > 0 && listeners.every((address) => ['127.0.0.1', '::1'].includes(address)),
      'corepack pnpm context:memory:start',
      `port=${port}, addresses=${listeners.join(',') || '<none>'}`,
    );
  }

  check(
    'AgentMemory data directory is outside the repository',
    Boolean(profile.dataDir) && !isPathInside(root, profile.dataDir),
    `set AGENTMEMORY_DATA_DIR outside ${root}`,
    profile.dataDir,
  );

  let mcpServers = [];
  try {
    const result = commandResult('codex', ['mcp', 'list', '--json'], { cwd: root });
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'codex mcp list failed');
    mcpServers = JSON.parse(result.stdout);
    const agentMemory = mcpServers.filter((server) => server.name === 'agentmemory');
    const configured = agentMemory[0];
    check(
      'Exactly one AgentMemory MCP server',
      agentMemory.length === 1 &&
        configured?.enabled === true &&
        configured?.transport?.command === 'npx' &&
        JSON.stringify(configured?.transport?.args) ===
          JSON.stringify(['-y', `@agentmemory/mcp@${MCP_SHIM_VERSION}`]) &&
        configured?.transport?.env?.AGENTMEMORY_URL === profile.url &&
        configured?.transport?.env?.AGENTMEMORY_TOOLS === 'core' &&
        mcpServers.filter((server) => server.name === 'node_repl').length === 1,
      'restore .codex/config.toml from the repository and restart Codex',
      `agentmemory=${agentMemory.length}, other=${mcpServers.filter((server) => server.name !== 'agentmemory').map((server) => server.name).join(',') || '<none>'}`,
    );
  } catch (error) {
    check('Exactly one AgentMemory MCP server', false, 'restart Codex from this repository', error.message);
  }

  try {
    const userHooksPath = join(homedir(), '.codex', 'hooks.json');
    const userHooks = inspectJsonFile(userHooksPath);
    let hooksOk = true;
    const hookDetails = [];
    for (const [event, scriptName] of Object.entries(REQUIRED_AGENTMEMORY_HOOKS)) {
      const matching = hookCommands(userHooks, event).filter((command) =>
        command.toLowerCase().includes('@agentmemory'),
      );
      const scriptPath = matching.length === 1 ? commandScriptPath(matching[0]) : null;
      const eventOk =
        matching.length === 1 &&
        scriptPath?.toLowerCase().endsWith(scriptName.toLowerCase()) &&
        existsSync(scriptPath);
      hooksOk &&= Boolean(eventOk);
      hookDetails.push(`${event}=${matching.length}/${scriptPath && existsSync(scriptPath) ? 'exists' : 'missing'}`);
    }
    const projectHooksPath = join(root, '.codex', 'hooks.json');
    const projectHooksRaw = readFileSync(projectHooksPath, 'utf8');
    const projectHooks = inspectJsonFile(projectHooksPath);
    const graphifyHookPattern = /(?:graphify\.exe|run-graphify-lmstudio\.mjs)\s+hook-check/iu;
    const graphifyPreserved =
      graphifyHookPattern.test(projectHooksRaw) &&
      hookCommands(projectHooks, 'PreToolUse').some((command) => graphifyHookPattern.test(command));
    check(
      'AgentMemory hooks and project Graphify hook',
      hooksOk && graphifyPreserved,
      'merge the six AgentMemory hooks into ~/.codex/hooks.json and restore .codex/hooks.json',
      `${hookDetails.join(', ')}, graphify=${graphifyPreserved ? 'present' : 'missing'}`,
    );
  } catch (error) {
    check(
      'AgentMemory hooks and project Graphify hook',
      false,
      'restore ~/.codex/hooks.json and .codex/hooks.json',
      error.message,
    );
  }

  try {
    runMcpSmoke();
    check('AgentMemory MCP smoke', true, 'corepack pnpm context:memory:smoke');
  } catch (error) {
    check('AgentMemory MCP smoke', false, 'corepack pnpm context:memory:smoke', error.message);
  }

  try {
    const graph = validateGraph(root);
    check(
      'Graphify graph',
      true,
      'restore graphify-out/graph.json',
      `${graph.nodes} nodes, ${graph.edges} edges`,
    );
  } catch (error) {
    check('Graphify graph', false, 'restore graphify-out/graph.json', error.message);
  }

  if (failures.length > 0) {
    console.error(`context:verify failed (${failures.length} mismatches):`);
    for (const failure of failures) {
      console.error(`- ${failure.name}; recovery: ${failure.recovery}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`context:verify passed (${checks.length} checks).`);
  }
}

function containsMarker(value, marker) {
  return collectStrings(value).some((text) => text.includes(marker));
}

async function selftest() {
  currentProfile();
  if (!(await isHealthy())) {
    throw new Error(`AgentMemory is not healthy at ${agentMemoryUrl()}.`);
  }
  const root = gitRoot();
  const marker = `agentmemory-selftest-${Date.now()}`;
  let memoryId;
  try {
    const saved = await fetchJson('/agentmemory/remember', {
      method: 'POST',
      body: JSON.stringify({ content: marker, type: 'fact', project: root }),
    });
    memoryId = saved?.memory?.id;
    if (!saved?.success || !memoryId) {
      throw new Error('AgentMemory did not return an id for the self-test memory.');
    }
    const search = await fetchJson('/agentmemory/smart-search', {
      method: 'POST',
      body: JSON.stringify({ query: marker, project: root, includeLessons: false, limit: 20 }),
    });
    const ids = Array.isArray(search?.results)
      ? search.results.map((entry) => entry?.obsId ?? entry?.id).filter(Boolean)
      : [];
    if (!ids.includes(memoryId) && !containsMarker(search, marker)) {
      throw new Error('The saved self-test marker was not returned by smart search.');
    }
    console.log(`AgentMemory self-test saved and found ${marker}.`);
  } finally {
    if (memoryId) {
      const deletion = await fetchJson('/agentmemory/governance/memories', {
        method: 'DELETE',
        body: JSON.stringify({ memoryIds: [memoryId], reason: 'automated self-test cleanup' }),
      });
      if (!deletion?.success || deletion.deleted !== 1) {
        throw new Error(`Self-test cleanup failed for ${marker}.`);
      }
      const response = await fetch(`${agentMemoryUrl()}/agentmemory/memories/${memoryId}`, {
        headers: authHeaders(),
      });
      if (response.status !== 404) {
        throw new Error(`Self-test data remained after cleanup: ${marker}.`);
      }
      console.log(`AgentMemory self-test removed ${marker}.`);
    }
  }
}

function usage() {
  console.log(`Usage: node scripts/context-memory.mjs <command>

Commands:
  start                              Start AgentMemory on loopback only
  stop                               Stop the shared AgentMemory service
  status                             Show AgentMemory status
  doctor                             Run non-mutating AgentMemory diagnostics
  graph-import [--assert-idempotent] Import the existing Graphify graph
  refresh [--dry-run]                Run graphify update ., then import on success
  verify                             Validate the complete integration without changes
  selftest                           Round-trip one temporary memory and remove it`);
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
      currentProfile();
      runCli(['status']);
      break;
    case 'doctor':
      currentProfile();
      runCli(['doctor', '--dry-run']);
      break;
    case 'graph-import':
      await importGraph({ assertIdempotent: args.includes('--assert-idempotent') });
      break;
    case 'refresh':
      await refresh({ dryRun: args.includes('--dry-run') });
      break;
    case 'verify':
      await verify();
      break;
    case 'selftest':
      await selftest();
      break;
    default:
      usage();
      if (command) process.exitCode = 1;
  }
}

const isEntryPoint =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntryPoint) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
    if (process.argv[2] === 'verify') {
      console.error(
        'Recovery: compare docs/development/agentmemory.env.example with ~/.agentmemory/.env, merge safely, then run corepack pnpm context:verify.',
      );
    }
  });
}
