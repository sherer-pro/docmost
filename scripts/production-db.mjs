import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POSTGRES_IMAGE =
  "postgres:18@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636";
const DEFAULT_COMPOSE_FILE = "compose.production.yml";
const DEFAULT_ENV_FILE = "/etc/docmost/docmost.env";
const DEFAULT_STATE_FILE = "/var/lib/docmost/deployment/postgres.env";
const DEFAULT_BACKUP_DIR = "/var/backups/docmost/postgres";
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SAFE_DATABASE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/u;
const IMMUTABLE_IMAGE = /@sha256:[0-9a-f]{64}$/u;
const ACCEPTANCE_PHASE = "acceptance";
const ACCEPTED_PHASE = "accepted";

function usage() {
  return `Usage:
  corepack pnpm production:db -- preflight [options]
  corepack pnpm production:db -- plan [options]
  corepack pnpm production:db -- migrate --yes [options]
  corepack pnpm production:db -- rollback --yes [options]
  corepack pnpm production:db -- accept --yes [options]

Options:
  --compose-file PATH  Default: ${DEFAULT_COMPOSE_FILE}
  --env-file PATH      Default: ${DEFAULT_ENV_FILE}
  --state-file PATH    Default: ${DEFAULT_STATE_FILE}
  --backup-dir PATH    Default: ${DEFAULT_BACKUP_DIR}
  --json               Print machine-readable output
  --yes                Confirm a state-changing operation`;
}

export function parseEnvFile(source) {
  const values = {};
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/u.exec(trimmed);
    if (!match) {
      throw new Error("Environment file contains an unsupported line");
    }
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export function serializeEnvFile(values) {
  return `${Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      if (!/^[A-Za-z0-9_./:@-]*$/u.test(String(value))) {
        throw new Error(
          `State value for ${key} contains unsupported characters`,
        );
      }
      return `${key}=${value}`;
    })
    .join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {
    command: argv[0],
    composeFile: DEFAULT_COMPOSE_FILE,
    envFile: process.env.DOCMOST_PRODUCTION_ENV_FILE || DEFAULT_ENV_FILE,
    stateFile: process.env.DOCMOST_PRODUCTION_STATE_FILE || DEFAULT_STATE_FILE,
    backupDir: process.env.DOCMOST_BACKUP_DIR || DEFAULT_BACKUP_DIR,
    json: false,
    yes: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--yes") options.yes = true;
    else if (
      ["--compose-file", "--env-file", "--state-file", "--backup-dir"].includes(
        argument,
      )
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      const key = {
        "--compose-file": "composeFile",
        "--env-file": "envFile",
        "--state-file": "stateFile",
        "--backup-dir": "backupDir",
      }[argument];
      options[key] = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function readEnvFile(path, required = true) {
  if (!existsSync(path)) {
    if (required)
      throw new Error(`Required environment file is missing: ${path}`);
    return {};
  }
  return parseEnvFile(readFileSync(path, "utf8"));
}

function assertSafeName(value, label) {
  if (!SAFE_NAME.test(value || "")) {
    throw new Error(`${label} must be a simple Docker resource name`);
  }
}

function assertDatabaseIdentifier(value, label) {
  if (!SAFE_DATABASE_IDENTIFIER.test(value || "")) {
    throw new Error(`${label} is not a supported PostgreSQL identifier`);
  }
}

function assertSafeAbsolutePath(path, label, repositoryRoot) {
  const absolute = resolve(path);
  if (!isAbsolute(path) || absolute === resolve(absolute, "/")) {
    throw new Error(`${label} must be an explicit non-root absolute path`);
  }
  const fromRepository = relative(repositoryRoot, absolute);
  if (
    fromRepository === "" ||
    (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))
  ) {
    throw new Error(`${label} must be outside the repository`);
  }
  return absolute;
}

function atomicWrite(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  const descriptor = openSync(temporary, "wx", mode);
  try {
    writeFileSync(descriptor, content, "utf8");
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
}

function commandResult(binary, args, options = {}) {
  const { allowedStatuses = [0], ...spawnOptions } = options;
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...spawnOptions,
  });
  if (result.error) throw result.error;
  if (!allowedStatuses.includes(result.status)) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `${binary} ${args[0] || ""} failed with exit ${result.status}${
        message ? `: ${message.slice(0, 800)}` : ""
      }`,
    );
  }
  return result;
}

function composeArgs(context, ...args) {
  return [
    "compose",
    "--env-file",
    context.envFile,
    "--env-file",
    context.stateFile,
    "-f",
    context.composeFile,
    ...args,
  ];
}

function compose(context, args, options = {}) {
  return commandResult("docker", composeArgs(context, ...args), {
    env: context.childEnv,
    ...options,
  });
}

function requireLinux() {
  if (process.platform !== "linux") {
    throw new Error(
      "Production database state changes are supported only on Linux",
    );
  }
}

function createContext(options) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const composeFile = resolve(options.composeFile);
  const envFile = resolve(options.envFile);
  const stateFile = resolve(options.stateFile);
  const backupDir = resolve(options.backupDir);
  const baseEnv = readEnvFile(envFile);
  const state = readEnvFile(stateFile);
  const effective = { ...baseEnv, ...state, ...process.env };

  for (const key of [
    "DOCMOST_IMAGE",
    "POSTGRES_VOLUME_NAME",
    "DOCMOST_STORAGE_VOLUME_NAME",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "APP_SECRET",
    "DOCMOST_MAINTENANCE_ENTER_HOOK",
    "DOCMOST_MAINTENANCE_EXIT_HOOK",
  ]) {
    if (!effective[key]) throw new Error(`${key} is required`);
  }
  if (!IMMUTABLE_IMAGE.test(baseEnv.DOCMOST_IMAGE || "")) {
    throw new Error("DOCMOST_IMAGE must be pinned by sha256 digest");
  }
  assertSafeName(effective.POSTGRES_VOLUME_NAME, "POSTGRES_VOLUME_NAME");
  assertSafeName(
    effective.DOCMOST_STORAGE_VOLUME_NAME,
    "DOCMOST_STORAGE_VOLUME_NAME",
  );
  assertDatabaseIdentifier(effective.POSTGRES_DB, "POSTGRES_DB");
  assertDatabaseIdentifier(effective.POSTGRES_USER, "POSTGRES_USER");
  for (const key of [
    "DOCMOST_MAINTENANCE_ENTER_HOOK",
    "DOCMOST_MAINTENANCE_EXIT_HOOK",
  ]) {
    const hook = assertSafeAbsolutePath(effective[key], key, repositoryRoot);
    accessSync(hook, fsConstants.X_OK);
  }
  if (effective.DOCMOST_ROLLBACK_HOOK) {
    const hook = assertSafeAbsolutePath(
      effective.DOCMOST_ROLLBACK_HOOK,
      "DOCMOST_ROLLBACK_HOOK",
      repositoryRoot,
    );
    accessSync(hook, fsConstants.X_OK);
  }

  return {
    ...options,
    repositoryRoot,
    composeFile,
    envFile,
    stateFile,
    backupDir,
    baseEnv,
    state,
    effective,
    childEnv: { ...process.env, ...baseEnv, ...state },
  };
}

function runOperatorHook(context, key, migrationId) {
  const hook = context.effective[key];
  commandResult(hook, [], {
    env: {
      PATH: process.env.PATH,
      APP_URL: context.effective.APP_URL,
      COMPOSE_PROJECT_NAME: context.effective.COMPOSE_PROJECT_NAME || "docmost",
      DOCMOST_MIGRATION_ID: migrationId,
    },
  });
}

function runExternalRollbackHook(context, migrationId) {
  if (!context.effective.DOCMOST_ROLLBACK_HOOK) return false;
  runOperatorHook(context, "DOCMOST_ROLLBACK_HOOK", migrationId);
  return true;
}

function parseLastJson(source) {
  const lines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // Compose may add progress lines around the command output.
    }
  }
  throw new Error("Database preflight did not return JSON");
}

function runPreflight(context, requireLatest = false) {
  const args = ["run", "--rm", "--no-deps", "-T", "db-preflight"];
  if (requireLatest) {
    args.push(
      "node",
      "apps/server/dist/apps/server/src/database/preflight.js",
      "--require-latest",
    );
  }
  const result = compose(context, args, {
    allowedStatuses: [0, 20, 30, 40],
  });
  const report = parseLastJson(result.stdout);
  if (Number(report.exitCode) !== Number(result.status)) {
    throw new Error("Database preflight exit code does not match its report");
  }
  return report;
}

function ensureRunningDatabase(context) {
  const id = compose(context, ["ps", "-q", "db"]).stdout.trim();
  if (!id) {
    throw new Error(
      "The production PostgreSQL service must already be running",
    );
  }
  const state = commandResult("docker", ["inspect", id]).stdout;
  const inspected = JSON.parse(state)[0];
  if (!inspected?.State?.Running) {
    throw new Error("The production PostgreSQL service is not running");
  }
  return { id, inspected };
}

function inspectVolume(name) {
  const result = commandResult("docker", ["volume", "inspect", name]);
  return JSON.parse(result.stdout)[0];
}

function volumeSize(context, volumeName) {
  const result = commandResult("docker", [
    "run",
    "--rm",
    "--mount",
    `type=volume,src=${volumeName},dst=/source,readonly`,
    "--entrypoint",
    "sh",
    context.baseEnv.DOCMOST_IMAGE,
    "-ceu",
    "du -sb /source | cut -f1",
  ]);
  const size = Number(result.stdout.trim());
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("Could not determine the storage volume size");
  }
  return size;
}

function nearestExistingPath(path) {
  let candidate = resolve(path);
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return candidate;
}

function freeBytes(path) {
  const stats = statfsSync(nearestExistingPath(path));
  return Number(stats.bavail) * Number(stats.bsize);
}

function dockerRootDirectory() {
  return commandResult("docker", [
    "info",
    "--format",
    "{{.DockerRootDir}}",
  ]).stdout.trim();
}

export function buildCapacityPlan({
  databaseBytes,
  storageBytes,
  backupFreeBytes,
  dockerFreeBytes,
  rehearsalSeconds,
}) {
  const requiredBackupBytes = Math.ceil(
    databaseBytes * 1.25 + storageBytes * 1.1,
  );
  const requiredDockerBytes = Math.ceil(databaseBytes * 1.5);
  const measured = Number(rehearsalSeconds);
  const estimatedDowntimeSeconds =
    Number.isFinite(measured) && measured > 0
      ? Math.ceil(measured * 1.5 + 900)
      : Math.ceil(
          (databaseBytes * 2 + storageBytes) / (25 * 1024 * 1024) + 900,
        );
  return {
    requiredBackupBytes,
    requiredDockerBytes,
    backupFreeBytes,
    dockerFreeBytes,
    estimatedDowntimeSeconds,
    capacityOk:
      backupFreeBytes >= requiredBackupBytes &&
      dockerFreeBytes >= requiredDockerBytes,
  };
}

function buildPlan(context) {
  requireLinux();
  ensureRunningDatabase(context);
  inspectVolume(context.effective.POSTGRES_VOLUME_NAME);
  inspectVolume(context.effective.DOCMOST_STORAGE_VOLUME_NAME);
  const preflight = runPreflight(context, false);
  const databaseBytes = Number(preflight.database?.sizeBytes ?? 0);
  const storageBytes = volumeSize(
    context,
    context.effective.DOCMOST_STORAGE_VOLUME_NAME,
  );
  const dockerRoot = dockerRootDirectory();
  const capacity = buildCapacityPlan({
    databaseBytes,
    storageBytes,
    backupFreeBytes: freeBytes(context.backupDir),
    dockerFreeBytes: freeBytes(dockerRoot),
    rehearsalSeconds: context.effective.POSTGRES_REHEARSAL_SECONDS,
  });
  return {
    status:
      [0, 20].includes(preflight.exitCode) && capacity.capacityOk
        ? "ready"
        : "blocked",
    sourceVolume: context.effective.POSTGRES_VOLUME_NAME,
    storageVolume: context.effective.DOCMOST_STORAGE_VOLUME_NAME,
    targetImage: POSTGRES_IMAGE,
    databaseBytes,
    storageBytes,
    capacity,
    preflight,
  };
}

function printResult(value, json = false) {
  if (json) {
    console.log(JSON.stringify(value));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function composePsql(context, sqlSource) {
  return compose(context, [
    "exec",
    "-T",
    "db",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    context.effective.POSTGRES_USER,
    "-d",
    context.effective.POSTGRES_DB,
    "-At",
    "-c",
    sqlSource,
  ]).stdout.trim();
}

function containerPsql(context, containerName, sqlSource) {
  return commandResult("docker", [
    "exec",
    containerName,
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    context.effective.POSTGRES_USER,
    "-d",
    context.effective.POSTGRES_DB,
    "-At",
    "-c",
    sqlSource,
  ]).stdout.trim();
}

const INVENTORY_SQL = String.raw`
CREATE TEMP TABLE docmost_table_counts(name text PRIMARY KEY, row_count bigint);
DO $docmost$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, tablename
  LOOP
    EXECUTE format(
      'INSERT INTO docmost_table_counts VALUES (%L, (SELECT count(*) FROM %I.%I))',
      item.schemaname || '.' || item.tablename,
      item.schemaname,
      item.tablename
    );
  END LOOP;
END
$docmost$;
SELECT jsonb_build_object(
  'tables', COALESCE((SELECT jsonb_object_agg(name, row_count ORDER BY name) FROM docmost_table_counts), '{}'::jsonb),
  'sequences', COALESCE((SELECT jsonb_object_agg(schemaname || '.' || sequencename, COALESCE(last_value::text, 'null') ORDER BY schemaname, sequencename) FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog', 'information_schema')), '{}'::jsonb),
  'extensions', COALESCE((SELECT jsonb_object_agg(extname, extversion ORDER BY extname) FROM pg_extension), '{}'::jsonb),
  'largeObjects', (SELECT count(*) FROM pg_largeobject_metadata),
  'constraints', COALESCE((
    SELECT jsonb_object_agg(
      quote_ident(namespace.nspname) || '.' || quote_ident(table_state.relname) || '.' || quote_ident(constraint_state.conname),
      pg_get_constraintdef(constraint_state.oid, true)
      ORDER BY namespace.nspname, table_state.relname, constraint_state.conname
    )
    FROM pg_constraint AS constraint_state
    JOIN pg_class AS table_state ON table_state.oid = constraint_state.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = table_state.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
  ), '{}'::jsonb),
  'indexes', COALESCE((
    SELECT jsonb_object_agg(
      quote_ident(namespace.nspname) || '.' || quote_ident(index_state.relname),
      pg_get_indexdef(index_state.oid)
      ORDER BY namespace.nspname, index_state.relname
    )
    FROM pg_index AS index_metadata
    JOIN pg_class AS index_state ON index_state.oid = index_metadata.indexrelid
    JOIN pg_namespace AS namespace ON namespace.oid = index_state.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
  ), '{}'::jsonb),
  'unvalidatedConstraints', (SELECT count(*) FROM pg_constraint WHERE NOT convalidated),
  'invalidIndexes', (SELECT count(*) FROM pg_index WHERE NOT indisvalid)
)::text;
`;

function sourceInventory(context) {
  return JSON.parse(composePsql(context, INVENTORY_SQL).split(/\r?\n/u).at(-1));
}

function targetInventory(context, containerName) {
  return JSON.parse(
    containerPsql(context, containerName, INVENTORY_SQL).split(/\r?\n/u).at(-1),
  );
}

export function compareInventories(source, target) {
  const normalize = (value) => JSON.stringify(value, Object.keys(value).sort());
  const differences = [];
  for (const key of [
    "tables",
    "sequences",
    "extensions",
    "largeObjects",
    "constraints",
    "indexes",
    "unvalidatedConstraints",
    "invalidIndexes",
  ]) {
    if (normalize(source[key]) !== normalize(target[key]))
      differences.push(key);
  }
  return differences;
}

function streamCommandToFile(binary, args, destination, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    const child = spawn(binary, args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let childCode;
    let outputFinished = false;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const finish = () => {
      if (settled || childCode === undefined || !outputFinished) return;
      settled = true;
      if (childCode === 0) resolvePromise();
      else {
        reject(
          new Error(
            `Backup command failed with exit ${childCode}: ${stderr.slice(0, 800)}`,
          ),
        );
      }
    };
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.pipe(output);
    child.on("error", rejectOnce);
    child.stdout.on("error", rejectOnce);
    output.on("error", rejectOnce);
    output.on("finish", () => {
      outputFinished = true;
      finish();
    });
    child.on("close", (code) => {
      childCode = code;
      finish();
    });
  });
}

function streamFileToCommand(source, binary, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.resume();
    const input = createReadStream(source);
    input.on("error", reject);
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    input.pipe(child.stdin);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(
            `Restore command failed with exit ${code}: ${stderr.slice(0, 800)}`,
          ),
        );
    });
  });
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function waitForContainerHealth(containerName, timeoutSeconds = 180) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const result = commandResult(
      "docker",
      [
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        containerName,
      ],
      { allowedStatuses: [0, 1] },
    );
    if (
      result.status === 0 &&
      ["healthy", "running"].includes(result.stdout.trim())
    ) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  throw new Error(`Container ${containerName} did not become healthy`);
}

function waitForPostgresReady(context, containerName, timeoutSeconds = 180) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const result = commandResult(
      "docker",
      [
        "exec",
        containerName,
        "sh",
        "-ceu",
        'test "$(cat /proc/1/comm)" = postgres && pg_isready -U "$1" -d "$2"',
        "docmost-readiness",
        context.effective.POSTGRES_USER,
        context.effective.POSTGRES_DB,
      ],
      { allowedStatuses: [0, 1, 2, 3] },
    );
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  throw new Error(`PostgreSQL container ${containerName} did not become ready`);
}

function composeServiceContainer(context, service) {
  return compose(context, ["ps", "-q", service]).stdout.trim();
}

function waitForComposeService(context, service) {
  const id = composeServiceContainer(context, service);
  if (!id) throw new Error(`Compose service ${service} has no container`);
  waitForContainerHealth(id);
}

function composeNetwork(databaseInspection) {
  const names = Object.keys(databaseInspection.NetworkSettings?.Networks || {});
  const preferred = names.find((name) => name.endsWith("_default"));
  if (!preferred && names.length !== 1) {
    throw new Error("Could not resolve the isolated Compose database network");
  }
  return preferred || names[0];
}

function runningServiceImage(context, service, label) {
  const id = composeServiceContainer(context, service);
  if (!id)
    throw new Error(
      `The current ${label} container is required for rollback metadata`,
    );
  const container = JSON.parse(
    commandResult("docker", ["inspect", id]).stdout,
  )[0];
  const image = JSON.parse(
    commandResult("docker", ["image", "inspect", container.Image]).stdout,
  )[0];
  return image.RepoDigests?.[0] || container.Config?.Image;
}

function runningApplicationImage(context) {
  return runningServiceImage(context, "docmost", "Docmost");
}

function runningDatabaseImage(context) {
  return runningServiceImage(context, "db", "PostgreSQL");
}

function candidateDatabaseUrl(context, containerName) {
  const user = encodeURIComponent(context.effective.POSTGRES_USER);
  const password = encodeURIComponent(context.effective.POSTGRES_PASSWORD);
  const database = encodeURIComponent(context.effective.POSTGRES_DB);
  return `postgresql://${user}:${password}@${containerName}:5432/${database}`;
}

function runAppDatabaseCommand(
  context,
  network,
  databaseUrlFile,
  script,
  extraArguments = [],
  appSecretFile,
  allowedStatuses = [0, 20, 30, 40],
) {
  const secretArguments = appSecretFile
    ? [
        "-e",
        "APP_SECRET_FILE=/run/secrets/app_secret",
        "--mount",
        `type=bind,src=${appSecretFile},dst=/run/secrets/app_secret,readonly`,
      ]
    : [];
  return commandResult(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      network,
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--user",
      "0:0",
      "-e",
      "DATABASE_URL_FILE=/run/secrets/database_url",
      "-e",
      "POSTGRES_EXPECTED_MAJOR=18",
      "-e",
      "POSTGRES_EXPECTED_RUNTIME=linux-gnu",
      "--mount",
      `type=bind,src=${databaseUrlFile},dst=/run/secrets/database_url,readonly`,
      ...secretArguments,
      "--entrypoint",
      "node",
      context.baseEnv.DOCMOST_IMAGE,
      script,
      ...extraArguments,
    ],
    { allowedStatuses },
  );
}

function cleanupCandidate(containerName) {
  commandResult("docker", ["rm", "-f", containerName], {
    allowedStatuses: [0, 1],
  });
}

export function rollbackState(
  context,
  previousVolume,
  previousImage,
  previousPostgresImage,
  migrationId,
) {
  return {
    ...context.state,
    DOCMOST_IMAGE: previousImage,
    POSTGRES_IMAGE: previousPostgresImage,
    POSTGRES_VOLUME_NAME: previousVolume,
    MIGRATION_ID: migrationId,
    MIGRATION_PHASE: "rolled_back",
  };
}

export function rollbackPreflightMatches(report, expectedExitCode) {
  return (
    [0, 20].includes(Number(expectedExitCode)) &&
    Number(report?.exitCode) === Number(expectedExitCode)
  );
}

async function migrate(context) {
  requireLinux();
  if (!context.yes) throw new Error("migrate requires --yes");
  const plan = buildPlan(context);
  if (plan.status !== "ready") {
    throw new Error(
      "Migration plan is blocked by preflight or capacity checks",
    );
  }

  const backupRoot = assertSafeAbsolutePath(
    context.backupDir,
    "Backup directory",
    context.repositoryRoot,
  );
  const statePath = assertSafeAbsolutePath(
    context.stateFile,
    "Deployment state file",
    context.repositoryRoot,
  );
  const migrationId = new Date().toISOString().replace(/[-:.TZ]/gu, "");
  const migrationDir = resolve(backupRoot, migrationId);
  if (existsSync(migrationDir))
    throw new Error("Migration directory already exists");
  mkdirSync(migrationDir, { recursive: true, mode: 0o700 });

  const sourceVolume = context.effective.POSTGRES_VOLUME_NAME;
  const candidateVolume = `${sourceVolume}-candidate-${migrationId}`;
  const candidateContainer = `${context.effective.COMPOSE_PROJECT_NAME || "docmost"}-db-candidate-${migrationId}`;
  assertSafeName(candidateVolume, "Candidate volume");
  assertSafeName(candidateContainer, "Candidate container");
  const previousImage = runningApplicationImage(context);
  const database = ensureRunningDatabase(context);
  const previousPostgresImage = runningDatabaseImage(context);
  const network = composeNetwork(database.inspected);
  const dumpPath = resolve(migrationDir, "database.dump");
  const storagePath = resolve(migrationDir, "storage.tar.gz");
  const passwordPath = resolve(migrationDir, ".candidate-password");
  const databaseUrlPath = resolve(migrationDir, ".candidate-database-url");
  const appSecretPath = resolve(migrationDir, ".candidate-app-secret");
  let maintenanceEntered = false;
  let writersStopped = false;

  atomicWrite(
    resolve(migrationDir, "manifest.json"),
    `${JSON.stringify(
      {
        migrationId,
        phase: "prepared",
        sourceVolume,
        candidateVolume,
        previousImage,
        previousPostgresImage,
        targetImage: context.baseEnv.DOCMOST_IMAGE,
        postgresImage: POSTGRES_IMAGE,
        plan,
      },
      null,
      2,
    )}\n`,
  );

  try {
    runOperatorHook(context, "DOCMOST_MAINTENANCE_ENTER_HOOK", migrationId);
    maintenanceEntered = true;
    compose(context, ["stop", "docmost", "collab"]);
    writersStopped = true;
    const activeConnections = Number(
      composePsql(
        context,
        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
      ),
    );
    if (activeConnections !== 0) {
      throw new Error(
        `${activeConnections} database connections remain after writers stopped`,
      );
    }
    composePsql(context, "CHECKPOINT");
    const source = sourceInventory(context);

    await streamCommandToFile(
      "docker",
      composeArgs(
        context,
        "exec",
        "-T",
        "db",
        "pg_dump",
        "-U",
        context.effective.POSTGRES_USER,
        "-d",
        context.effective.POSTGRES_DB,
        "--format=custom",
        "--no-owner",
        "--no-acl",
      ),
      dumpPath,
      { env: context.childEnv },
    );
    commandResult("docker", [
      "run",
      "--rm",
      "--mount",
      `type=volume,src=${context.effective.DOCMOST_STORAGE_VOLUME_NAME},dst=/source,readonly`,
      "--mount",
      `type=bind,src=${migrationDir},dst=/backup`,
      "--entrypoint",
      "tar",
      context.baseEnv.DOCMOST_IMAGE,
      "-C",
      "/source",
      "-czf",
      "/backup/storage.tar.gz",
      ".",
    ]);
    commandResult("docker", [
      "run",
      "--rm",
      "--mount",
      `type=bind,src=${migrationDir},dst=/backup,readonly`,
      "--entrypoint",
      "pg_restore",
      POSTGRES_IMAGE,
      "--list",
      "/backup/database.dump",
    ]);

    const hashes = {
      database: await sha256(dumpPath),
      storage: await sha256(storagePath),
    };
    atomicWrite(
      resolve(migrationDir, "manifest.json"),
      `${JSON.stringify(
        {
          migrationId,
          phase: "backed_up",
          sourceVolume,
          candidateVolume,
          previousImage,
          previousPostgresImage,
          targetImage: context.baseEnv.DOCMOST_IMAGE,
          postgresImage: POSTGRES_IMAGE,
          plan,
          hashes,
          backupSizes: {
            database: statSync(dumpPath).size,
            storage: statSync(storagePath).size,
          },
          sourceInventory: source,
          retainUntil: new Date(Date.now() + 14 * 86400000).toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    atomicWrite(passwordPath, `${context.effective.POSTGRES_PASSWORD}\n`);
    atomicWrite(appSecretPath, `${context.effective.APP_SECRET}\n`);
    atomicWrite(
      databaseUrlPath,
      `${candidateDatabaseUrl(context, candidateContainer)}\n`,
    );
    commandResult("docker", [
      "volume",
      "create",
      "--label",
      "com.docmost.postgres.runtime=debian-glibc",
      "--label",
      "com.docmost.postgres.major=18",
      "--label",
      `com.docmost.migration.id=${migrationId}`,
      candidateVolume,
    ]);
    commandResult("docker", [
      "run",
      "-d",
      "--name",
      candidateContainer,
      "--network",
      network,
      "-e",
      `POSTGRES_DB=${context.effective.POSTGRES_DB}`,
      "-e",
      `POSTGRES_USER=${context.effective.POSTGRES_USER}`,
      "-e",
      "POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password",
      "--mount",
      `type=volume,src=${candidateVolume},dst=/var/lib/postgresql`,
      "--mount",
      `type=bind,src=${passwordPath},dst=/run/secrets/postgres_password,readonly`,
      POSTGRES_IMAGE,
    ]);
    waitForPostgresReady(context, candidateContainer);
    await streamFileToCommand(dumpPath, "docker", [
      "exec",
      "-i",
      candidateContainer,
      "pg_restore",
      "-U",
      context.effective.POSTGRES_USER,
      "-d",
      context.effective.POSTGRES_DB,
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
    ]);
    const restored = targetInventory(context, candidateContainer);
    const inventoryDifferences = compareInventories(source, restored);
    if (inventoryDifferences.length > 0) {
      throw new Error(
        `Restored database inventory differs: ${inventoryDifferences.join(", ")}`,
      );
    }

    runAppDatabaseCommand(
      context,
      network,
      databaseUrlPath,
      "apps/server/dist/apps/server/src/database/migrate-latest.js",
      [],
      appSecretPath,
      [0],
    );
    containerPsql(context, candidateContainer, "ANALYZE");
    const postflight = runAppDatabaseCommand(
      context,
      network,
      databaseUrlPath,
      "apps/server/dist/apps/server/src/database/preflight.js",
      ["--require-latest"],
    );
    const postflightReport = parseLastJson(postflight.stdout);
    if (postflightReport.exitCode !== 0) {
      throw new Error("Candidate database failed post-migration preflight");
    }

    commandResult("docker", ["stop", "--time", "30", candidateContainer]);
    commandResult("docker", ["rm", candidateContainer]);
    compose(context, ["stop", "db"]);
    const nextState = {
      ...context.state,
      POSTGRES_VOLUME_NAME: candidateVolume,
      POSTGRES_IMAGE,
      PREVIOUS_POSTGRES_VOLUME_NAME: sourceVolume,
      PREVIOUS_POSTGRES_IMAGE: previousPostgresImage,
      PREVIOUS_POSTGRES_PREFLIGHT_EXIT_CODE: String(plan.preflight.exitCode),
      PREVIOUS_DOCMOST_IMAGE: previousImage,
      MIGRATION_ID: migrationId,
      MIGRATION_PHASE: "cutover",
    };
    atomicWrite(statePath, serializeEnvFile(nextState));
    context.state = nextState;
    context.effective = { ...context.baseEnv, ...nextState, ...process.env };
    context.childEnv = { ...process.env, ...context.baseEnv, ...nextState };
    compose(context, ["up", "-d", "db", "redis"]);
    waitForComposeService(context, "db");
    const activePreflight = runPreflight(context, true);
    if (activePreflight.exitCode !== 0) {
      throw new Error("Active candidate database failed cutover preflight");
    }
    compose(context, ["run", "--rm", "--no-deps", "-T", "db-migrate"]);
    compose(context, ["up", "-d", "--force-recreate", "collab"]);
    waitForComposeService(context, "collab");
    compose(context, ["up", "-d", "--force-recreate", "docmost"]);
    waitForComposeService(context, "docmost");

    const acceptanceState = {
      ...nextState,
      MIGRATION_PHASE: ACCEPTANCE_PHASE,
    };
    atomicWrite(statePath, serializeEnvFile(acceptanceState));
    atomicWrite(
      resolve(migrationDir, "manifest.json"),
      `${JSON.stringify(
        {
          migrationId,
          phase: ACCEPTANCE_PHASE,
          sourceVolume,
          candidateVolume,
          previousImage,
          previousPostgresImage,
          targetImage: context.baseEnv.DOCMOST_IMAGE,
          postgresImage: POSTGRES_IMAGE,
          plan,
          hashes,
          sourceInventory: source,
          restoredInventory: restored,
          postflight: postflightReport,
          retainUntil: new Date(Date.now() + 14 * 86400000).toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    rmSync(passwordPath, { force: true });
    rmSync(databaseUrlPath, { force: true });
    rmSync(appSecretPath, { force: true });
    return {
      status: ACCEPTANCE_PHASE,
      migrationId,
      sourceVolume,
      candidateVolume,
      backupDirectory: migrationDir,
      retainSourceUntil: new Date(Date.now() + 14 * 86400000).toISOString(),
      next: "Keep ingress in maintenance mode, run acceptance checks, then run accept --yes or rollback --yes",
    };
  } catch (error) {
    cleanupCandidate(candidateContainer);
    rmSync(passwordPath, { force: true });
    rmSync(databaseUrlPath, { force: true });
    rmSync(appSecretPath, { force: true });
    if (!writersStopped) {
      if (maintenanceEntered) {
        runOperatorHook(context, "DOCMOST_MAINTENANCE_EXIT_HOOK", migrationId);
      }
      throw error;
    }
    const restoredState = rollbackState(
      context,
      sourceVolume,
      previousImage,
      previousPostgresImage,
      migrationId,
    );
    atomicWrite(statePath, serializeEnvFile(restoredState));
    context.state = restoredState;
    context.effective = {
      ...context.baseEnv,
      ...restoredState,
      ...process.env,
    };
    context.childEnv = { ...process.env, ...context.baseEnv, ...restoredState };
    if (!runExternalRollbackHook(context, migrationId)) {
      compose(context, ["up", "-d", "db"]);
      waitForComposeService(context, "db");
      compose(context, ["up", "-d", "--no-deps", "--force-recreate", "collab"]);
      waitForComposeService(context, "collab");
      compose(context, [
        "up",
        "-d",
        "--no-deps",
        "--force-recreate",
        "docmost",
      ]);
      waitForComposeService(context, "docmost");
      runOperatorHook(context, "DOCMOST_MAINTENANCE_EXIT_HOOK", migrationId);
    }
    throw error;
  }
}

function rollback(context) {
  requireLinux();
  if (!context.yes) throw new Error("rollback requires --yes");
  if (context.state.MIGRATION_PHASE !== ACCEPTANCE_PHASE) {
    throw new Error(
      "Automatic rollback is allowed only during acceptance before ingress opens",
    );
  }
  const previousVolume = context.state.PREVIOUS_POSTGRES_VOLUME_NAME;
  const previousImage = context.state.PREVIOUS_DOCMOST_IMAGE;
  const previousPostgresImage = context.state.PREVIOUS_POSTGRES_IMAGE;
  const previousPreflightExitCode = Number(
    context.state.PREVIOUS_POSTGRES_PREFLIGHT_EXIT_CODE,
  );
  if (
    !previousVolume ||
    !previousImage ||
    !previousPostgresImage ||
    ![0, 20].includes(previousPreflightExitCode)
  ) {
    throw new Error("Rollback metadata is incomplete");
  }
  inspectVolume(previousVolume);
  compose(context, ["stop", "docmost", "collab", "db"]);
  const targetState = {
    ...context.state,
    POSTGRES_IMAGE: previousPostgresImage,
    POSTGRES_VOLUME_NAME: previousVolume,
    MIGRATION_PHASE: "rollback_preflight",
  };
  delete targetState.DOCMOST_IMAGE;
  atomicWrite(context.stateFile, serializeEnvFile(targetState));
  context.state = targetState;
  context.childEnv = { ...process.env, ...context.baseEnv, ...targetState };
  const usedExternalRollback = runExternalRollbackHook(
    context,
    context.state.MIGRATION_ID,
  );
  if (!usedExternalRollback) {
    compose(context, ["up", "-d", "db"]);
    waitForComposeService(context, "db");
  }
  const report = runPreflight(context, false);
  if (!rollbackPreflightMatches(report, previousPreflightExitCode)) {
    throw new Error(
      "Previous database rollback preflight differs from the recorded source result",
    );
  }

  const finalState = rollbackState(
    context,
    previousVolume,
    previousImage,
    previousPostgresImage,
    context.state.MIGRATION_ID,
  );
  atomicWrite(context.stateFile, serializeEnvFile(finalState));
  context.state = finalState;
  context.effective = { ...context.baseEnv, ...finalState, ...process.env };
  context.childEnv = { ...process.env, ...context.baseEnv, ...finalState };
  if (!usedExternalRollback) {
    compose(context, ["up", "-d", "--no-deps", "--force-recreate", "collab"]);
    waitForComposeService(context, "collab");
    compose(context, ["up", "-d", "--no-deps", "--force-recreate", "docmost"]);
    waitForComposeService(context, "docmost");
    runOperatorHook(
      context,
      "DOCMOST_MAINTENANCE_EXIT_HOOK",
      context.state.MIGRATION_ID,
    );
  }
  return {
    status: "rolled_back",
    activeVolume: previousVolume,
    activeImage: previousImage,
    activePostgresImage: previousPostgresImage,
    externalRollback: usedExternalRollback,
  };
}

function accept(context) {
  requireLinux();
  if (!context.yes) throw new Error("accept requires --yes");
  if (
    ![ACCEPTANCE_PHASE, "ingress_opening"].includes(
      context.state.MIGRATION_PHASE,
    )
  ) {
    throw new Error("There is no migration awaiting acceptance");
  }
  waitForComposeService(context, "db");
  waitForComposeService(context, "collab");
  waitForComposeService(context, "docmost");
  const report = runPreflight(context, true);
  if (report.exitCode !== 0) {
    throw new Error("Database preflight must pass before acceptance");
  }
  const openingState =
    context.state.MIGRATION_PHASE === "ingress_opening"
      ? context.state
      : {
          ...context.state,
          MIGRATION_PHASE: "ingress_opening",
        };
  if (openingState !== context.state) {
    atomicWrite(context.stateFile, serializeEnvFile(openingState));
  }
  runOperatorHook(
    context,
    "DOCMOST_MAINTENANCE_EXIT_HOOK",
    context.state.MIGRATION_ID,
  );
  const nextState = {
    ...openingState,
    MIGRATION_PHASE: ACCEPTED_PHASE,
    MIGRATION_ACCEPTED_AT: new Date().toISOString(),
  };
  atomicWrite(context.stateFile, serializeEnvFile(nextState));
  return {
    status: ACCEPTED_PHASE,
    migrationId: nextState.MIGRATION_ID,
    warning:
      "Automatic rollback is now disabled; preserve the previous volume and backups for at least 14 days",
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.command || ["help", "--help", "-h"].includes(options.command)) {
    console.log(usage());
    return;
  }
  const context = createContext(options);
  if (options.command === "preflight") {
    ensureRunningDatabase(context);
    const report = runPreflight(context, false);
    printResult(report, options.json);
    process.exitCode = report.exitCode;
    return;
  }
  if (options.command === "plan") {
    const plan = buildPlan(context);
    printResult(plan, options.json);
    if (plan.status !== "ready") process.exitCode = 1;
    return;
  }
  if (options.command === "migrate") {
    printResult(await migrate(context), options.json);
    return;
  }
  if (options.command === "rollback") {
    printResult(rollback(context), options.json);
    return;
  }
  if (options.command === "accept") {
    printResult(accept(context), options.json);
    return;
  }
  throw new Error(`Unknown command: ${options.command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Production database operation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
