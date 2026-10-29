import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = mkdtempSync(join(tmpdir(), "docmost-backup-e2e-"));
const project = `docmost-backup-test-${randomUUID().slice(0, 8)}`;
const postgres =
  "postgres:18@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636";
const redis =
  "redis:8-alpine@sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241";
const typesense =
  "typesense/typesense:30.2@sha256:610f2d34b1f93d00762869da2c67736775e5798d19a2c8b91b014b8a0cc1e110";
const stateFile = join(root, "state.env");
const overlay = join(root, "fixture.yml");
const runtime = join(root, "runtime.env");
const override = join(root, "override.env");
const archive = join(root, "archive.tar");
const sourceVolumes = {
  database: `${project}-db`,
  storage: `${project}-storage`,
  redis: `${project}-redis`,
};
const typesenseVolume = `${project}-typesense`;
const environment = { ...process.env };
const hostUserArgs = process.getuid
  ? ["--user", `${process.getuid()}:${process.getgid()}`]
  : [];
for (const file of ["compose.production.yml", "compose.typesense.yml"]) {
  for (const match of readFileSync(join(repository, file), "utf8").matchAll(
    /\$\{([A-Z][A-Z0-9_]*)/gu,
  ))
    delete environment[match[1]];
}
for (const key of Object.keys(environment))
  if (key.startsWith("COMPOSE_") || key.startsWith("DOCMOST_PRODUCTION_"))
    delete environment[key];

function run(binary, args, { fail = false, input, encoding = "utf8" } = {}) {
  const result = spawnSync(binary, args, {
    cwd: repository,
    env: environment,
    input,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (fail)
    assert.notEqual(
      result.status,
      0,
      "negative scenario unexpectedly succeeded",
    );
  else
    assert.equal(
      result.status,
      0,
      `${binary} ${args[0]} failed: ${String(result.stderr).slice(-1200)}`,
    );
  return result;
}
const composeInputs = [
  "--env-file",
  runtime,
  "--env-file",
  override,
  "--env-file",
  stateFile,
  "-f",
  join(repository, "compose.production.yml"),
  "-f",
  join(repository, "compose.typesense.yml"),
  "-f",
  overlay,
];
const cliInputs = [
  "--env-file",
  runtime,
  "--env-file",
  override,
  "--state-file",
  stateFile,
  "--compose-file",
  join(repository, "compose.production.yml"),
  "--compose-file",
  join(repository, "compose.typesense.yml"),
  "--compose-file",
  overlay,
];
const compose = (...args) =>
  run("docker", ["compose", ...composeInputs, ...args]);
const cli = (command, file, extra = [], fail = false, preload) => {
  const result = run(
    process.execPath,
    [
      ...(preload ? ["--import", preload] : []),
      join(repository, "scripts/backup.mjs"),
      command,
      "--archive",
      file,
      ...cliInputs,
      "--json",
      ...extra,
    ],
    { fail },
  );
  return fail ? result : JSON.parse(result.stdout);
};
const query = (sql) =>
  compose(
    "exec",
    "-T",
    "db",
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "docmost",
    "-d",
    "docmost",
    "-At",
    "-c",
    sql,
  ).stdout.trim();
const mount = (file, target) => `${file}:${target}`;
function storageWrite(volume, value) {
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${volume}:/data`,
    postgres,
    "sh",
    "-ceu",
    "printf '%s' \"$1\" > /data/evidence.txt",
    "sh",
    value,
  ]);
}
function storageRead(volume) {
  return run("docker", [
    "run",
    "--rm",
    "-v",
    `${volume}:/data:ro`,
    postgres,
    "cat",
    "/data/evidence.txt",
  ]).stdout;
}
async function ready() {
  for (let index = 0; index < 50; index++) {
    const result = spawnSync(
      "docker",
      [
        "compose",
        ...composeInputs,
        "exec",
        "-T",
        "db",
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "docmost",
        "-d",
        "docmost",
      ],
      { cwd: repository, env: environment, encoding: "utf8" },
    );
    if (result.status === 0) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw Error("Fixture PostgreSQL did not become ready");
}
function mutateManifest(target, update) {
  const directory = join(root, `variant-${randomUUID()}`);
  mkdirSync(directory);
  run("docker", [
    "run",
    "--rm",
    ...hostUserArgs,
    "-v",
    mount(root, "/source"),
    postgres,
    "tar",
    "-xf",
    "/source/archive.tar",
    "-C",
    `/source/${basename(directory)}`,
  ]);
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  update(manifest);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  run("docker", [
    "run",
    "--rm",
    ...hostUserArgs,
    "-v",
    mount(root, "/source"),
    postgres,
    "tar",
    "-cf",
    `/source/${basename(target)}`,
    "-C",
    `/source/${basename(directory)}`,
    "manifest.json",
    "postgres.dump",
    "storage.tar.gz",
  ]);
}

function assertRestorePreflightCleanup(verifiedArchive) {
  const directory = mkdtempSync(join(root, "preflight-cleanup-"));
  const manifest = join(directory, "compose.yml");
  const runtimeFile = join(directory, "runtime.env");
  const state = join(directory, "state.env");
  writeFileSync(
    manifest,
    `name: ${project}-preflight\nservices:\n  db:\n    image: ${postgres}\n`,
  );
  writeFileSync(runtimeFile, "");
  const stateContent = `POSTGRES_VOLUME_NAME=${project}-unused-db\nDOCMOST_STORAGE_VOLUME_NAME=${project}-unused-storage\nMIGRATION_PHASE=ready\n`;
  writeFileSync(state, stateContent);
  function attempt(stateArgs, expectedError, preload) {
    const extractionRoot = mkdtempSync(join(directory, "extracted-"));
    const result = spawnSync(
      process.execPath,
      [
        ...(preload ? ["--import", preload] : []),
        join(repository, "scripts/backup.mjs"),
        "restore",
        "--archive",
        verifiedArchive,
        "--env-file",
        runtimeFile,
        "--compose-file",
        manifest,
        ...stateArgs,
        "--yes",
        "--replace",
        "--no-start",
        "--no-snapshot",
        "--maintenance-confirmed",
      ],
      {
        cwd: repository,
        env: {
          ...environment,
          TMPDIR: extractionRoot,
          TMP: extractionRoot,
          TEMP: extractionRoot,
        },
        encoding: "utf8",
      },
    );
    if (result.error) throw result.error;
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expectedError);
    assert.deepEqual(
      readdirSync(extractionRoot),
      [],
      "preflight failure must remove extracted archive contents",
    );
    assert.equal(readFileSync(state, "utf8"), stateContent);
    assert.equal(existsSync(`${state}.operation.lock`), false);
  }
  for (const stateArgs of [[], ["--state-file", state]])
    attempt(stateArgs, /database volume is not a safe Docker resource name/u);
  writeFileSync(
    manifest,
    `name: ${project}-preflight
services:
  db:
    image: ${postgres}
    volumes: [database:/var/lib/postgresql]
  redis:
    image: ${redis}
    volumes: [cache:/data]
  docmost:
    image: ${postgres}
    user: "1000:1000"
    volumes: [storage:/app/data/storage]
  collab:
    image: ${postgres}
    user: "1000:1000"
    volumes: [storage:/app/data/storage]
volumes:
  database: {name: ${project}-unused-db, external: true}
  storage: {name: ${project}-unused-storage, external: true}
  cache: {name: ${project}-unused-redis, external: true}
`,
  );
  // Fail only the initial running-services lookup, after real archive verification.
  const preload = `data:text/javascript,${encodeURIComponent(`
    import {syncBuiltinESMExports} from 'node:module';
    import childProcess from 'node:child_process';
    const original = childProcess.spawnSync;
    childProcess.spawnSync = (binary, args, options) => {
      if (binary === 'docker' && args.includes('compose') && args.includes('ps') && args.includes('--status'))
        return {status: 73, stdout: '', stderr: 'synthetic running-services failure'};
      return original(binary, args, options);
    };
    syncBuiltinESMExports();
  `)}`;
  attempt(
    ["--state-file", state],
    /docker compose ps failed with exit 73/u,
    preload,
  );
}

if (process.argv[2] === "--preflight-cleanup-only") {
  try {
    assertRestorePreflightCleanup(resolve(process.argv[3]));
    console.log(
      "backup-e2e: PASS preflight cleanup for development and deployment state",
    );
  } finally {
    assert.ok(
      basename(root).startsWith("docmost-backup-e2e-") &&
        root.startsWith(tmpdir()),
    );
    rmSync(root, { recursive: true, force: true });
  }
  process.exit(0);
}

let created = false;
let passed = false;
try {
  console.log(
    "backup-e2e: preparing an isolated production-manifest data-plane fixture",
  );
  const runtimeValues = {
    COMPOSE_PROJECT_NAME: project,
    DOCMOST_IMAGE: postgres,
    APP_URL: "https://fixture.invalid",
    COLLAB_URL: "https://collab.fixture.invalid",
    DRAWIO_URL: "https://drawio.fixture.invalid",
    TRUSTED_PROXIES: "loopback",
    EDGE_NETWORK_NAME: `${project}-edge`,
    POSTGRES_DB: "wrong_first_input",
    POSTGRES_USER: "wrong_first_input",
    POSTGRES_PASSWORD: "synthetic-only-password",
    APP_SECRET: "synthetic-only-app-secret-at-least-32-characters",
    COLLAB_INTERNAL_SECRET:
      "synthetic-only-collab-secret-at-least-32-characters",
    DATABASE_URL: "postgresql://docmost:synthetic-only-password@db/docmost",
    REDIS_URL: "redis://redis:6379",
    SEARCH_DRIVER: "typesense",
    TYPESENSE_SECRET_FILE: join(root, "typesense-key").replaceAll("\\", "/"),
    TYPESENSE_VOLUME_NAME: typesenseVolume,
  };
  writeFileSync(
    runtime,
    Object.entries(runtimeValues)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
  writeFileSync(override, "POSTGRES_DB=docmost\nPOSTGRES_USER=docmost\n");
  const initialState = `POSTGRES_VOLUME_NAME=${sourceVolumes.database}\nDOCMOST_STORAGE_VOLUME_NAME=${sourceVolumes.storage}\nREDIS_VOLUME_NAME=${sourceVolumes.redis}\nMIGRATION_PHASE=accepted\nDOCMOST_IMAGE=${postgres}\nPOSTGRES_IMAGE=${postgres}\n`;
  writeFileSync(stateFile, initialState);
  const runtimeBefore = readFileSync(runtime, "utf8");
  const overrideBefore = readFileSync(override, "utf8");
  writeFileSync(join(root, "typesense-key"), "synthetic-only-typesense-key");
  writeFileSync(
    overlay,
    `services:
  image-preflight:
    tmpfs: [/var/lib/postgresql]
    command: ["sh", "-c", "true"]
    pull_policy: never
  db-preflight:
    tmpfs: [/var/lib/postgresql]
    command: ["sh", "-c", "true"]
    pull_policy: never
  db-migrate:
    tmpfs: [/var/lib/postgresql]
    command: ["sh", "-c", "true"]
    pull_policy: never
  docmost:
    user: "1000:1000"
    tmpfs: [/var/lib/postgresql]
    command: ["sh", "-c", "exec sleep infinity"]
    pull_policy: never
    ports: !reset []
    volumes:
      - ./package.json:/fixture-relative-package.json:ro
    healthcheck:
      test: ["CMD", "true"]
      interval: 1s
  collab:
    user: "1000:1000"
    tmpfs: [/var/lib/postgresql]
    command: ["sh", "-c", "exec sleep infinity"]
    pull_policy: never
    ports: !reset []
    healthcheck:
      test: ["CMD", "true"]
      interval: 1s
`,
  );
  for (const image of [postgres, redis, typesense]) {
    if (
      spawnSync("docker", ["image", "inspect", image], {
        env: environment,
        stdio: "ignore",
      }).status !== 0
    )
      run("docker", ["pull", image]);
  }
  const rendered = JSON.parse(compose("config", "--format", "json").stdout);
  for (const service of Object.values(rendered.services))
    assert.ok(
      !service.ports?.length,
      "fixture must never publish production ports",
    );
  assert.equal(rendered.services.db.environment.POSTGRES_DB, "docmost");
  assert.equal(
    rendered.services.docmost.volumes
      .find((v) => v.target === "/fixture-relative-package.json")
      .source.replaceAll("\\", "/"),
    join(repository, "package.json").replaceAll("\\", "/"),
  );
  for (const name of [...Object.values(sourceVolumes), typesenseVolume])
    run("docker", [
      "volume",
      "create",
      "--label",
      `com.docmost.backup-test=${project}`,
      name,
    ]);
  run("docker", ["network", "create", `${project}-edge`]);
  created = true;
  compose("up", "-d", "--pull", "never");
  await ready();
  query(
    "CREATE TABLE users(id integer); INSERT INTO users VALUES(1); CREATE TABLE spaces(id integer); INSERT INTO spaces VALUES(1); CREATE TABLE pages(id integer); INSERT INTO pages VALUES(1); CREATE TABLE attachments(id integer); INSERT INTO attachments VALUES(1); CREATE TABLE kysely_migration(name text, timestamp text); INSERT INTO kysely_migration VALUES('fixture-migration', '1');",
  );
  storageWrite(sourceVolumes.storage, "before-backup");
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${sourceVolumes.storage}:/data`,
    postgres,
    "sh",
    "-ceu",
    "mkdir -p /data/private/nested; printf restricted > /data/private/nested/private.txt; chmod 700 /data/private /data/private/nested; chmod 600 /data/private/nested/private.txt",
  ]);
  console.log("backup-e2e: create, writer resume, archive verification");
  const partialCollisionProbe = join(root, "partial-collision.mjs");
  writeFileSync(
    partialCollisionProbe,
    `import { writeFileSync } from 'node:fs';
const archive = process.argv[process.argv.indexOf('--archive') + 1];
const sentinel = archive + '.part-' + process.pid;
writeFileSync(sentinel, 'existing partial must survive', { flag: 'wx', mode: 0o600 });
writeFileSync(archive + '.sentinel-path', sentinel, { flag: 'wx', mode: 0o600 });
`,
  );
  const backup = cli(
    "create",
    archive,
    ["--yes"],
    false,
    partialCollisionProbe,
  );
  assert.equal(backup.status, "created");
  const partialSentinel = readFileSync(`${archive}.sentinel-path`, "utf8");
  assert.equal(
    readFileSync(partialSentinel, "utf8"),
    "existing partial must survive",
  );
  if (process.getuid) {
    const metadata = statSync(archive);
    assert.equal(metadata.uid, process.getuid());
    assert.equal(metadata.gid, process.getgid());
    assert.equal(metadata.mode & 0o777, 0o600);
  }
  assert.equal(cli("verify", archive).manifest.database.counts.pages, 1);
  assertRestorePreflightCleanup(archive);
  assert.ok(
    compose("ps", "--status", "running", "--services").stdout.includes(
      "docmost",
    ),
  );
  assert.deepEqual(
    run("docker", [
      "run",
      "--rm",
      "-v",
      mount(root, "/source:ro"),
      postgres,
      "tar",
      "-tf",
      "/source/archive.tar",
    ])
      .stdout.trim()
      .split("\n")
      .sort(),
    ["manifest.json", "postgres.dump", "storage.tar.gz"],
  );
  console.log("backup-e2e: failed creation cleans outputs and resumes writers");
  const rejectedArchive = join(root, "unsafe-storage.tar");
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${sourceVolumes.storage}:/data`,
    postgres,
    "ln",
    "-s",
    "/outside",
    "/data/rejected-link",
  ]);
  try {
    const rejected = cli("create", rejectedArchive, ["--yes"], true);
    assert.match(rejected.stderr, /Archive entry type is not allowed/u);
    assert.equal(existsSync(rejectedArchive), false);
    assert.ok(
      !readdirSync(root).some((name) => name.startsWith("unsafe-storage.tar")),
    );
    const running = compose("ps", "--status", "running", "--services").stdout;
    for (const writer of ["docmost", "collab"])
      assert.ok(running.split(/\r?\n/u).includes(writer));
  } finally {
    run("docker", [
      "run",
      "--rm",
      "-v",
      `${sourceVolumes.storage}:/data`,
      postgres,
      "rm",
      "/data/rejected-link",
    ]);
  }
  query("INSERT INTO pages VALUES(2);");
  storageWrite(sourceVolumes.storage, "after-backup-source-data");
  console.log("backup-e2e: preflight negatives preserve source state and data");
  const beforeIds = compose("ps", "-a", "-q").stdout;
  writeFileSync(`${stateFile}.operation.lock`, "another-operation");
  cli("create", join(root, "locked.tar"), ["--yes"], true);
  run(
    process.execPath,
    [
      join(repository, "scripts/production-db.mjs"),
      "preflight",
      "--state-file",
      stateFile,
      "--env-file",
      runtime,
    ],
    { fail: true },
  );
  assert.equal(
    readFileSync(`${stateFile}.operation.lock`, "utf8"),
    "another-operation",
  );
  rmSync(`${stateFile}.operation.lock`);
  cli(
    "create",
    join(root, "missing-input.tar"),
    ["--yes", "--env-file", join(root, "missing-runtime.env")],
    true,
  );
  cli(
    "create",
    join(root, "missing-state.tar"),
    ["--yes", "--state-file", join(root, "missing-state.env")],
    true,
  );
  cli("restore", archive, ["--yes", "--replace"], true);
  writeFileSync(join(root, "bad.tar"), "not an archive");
  cli(
    "restore",
    join(root, "bad.tar"),
    ["--yes", "--replace", "--no-start", "--maintenance-confirmed"],
    true,
  );
  const missing = `${project}-missing`;
  writeFileSync(
    stateFile,
    initialState.replace(sourceVolumes.storage, missing),
  );
  cli("create", join(root, "must-not-exist.tar"), ["--yes"], true);
  assert.notEqual(
    spawnSync("docker", ["volume", "inspect", missing], { stdio: "ignore" })
      .status,
    0,
  );
  writeFileSync(stateFile, initialState);
  assert.equal(compose("ps", "-a", "-q").stdout, beforeIds);
  assert.equal(query("SELECT count(*) FROM pages"), "2");
  console.log(
    "backup-e2e: restored-invariant failure rolls back to untouched source volumes",
  );
  const badCounts = join(root, "bad-counts.tar");
  mutateManifest(badCounts, (manifest) => {
    manifest.database.counts.pages = 999;
  });
  const badCountsFailure = cli(
    "restore",
    badCounts,
    [
      "--yes",
      "--replace",
      "--no-start",
      "--maintenance-confirmed",
      "--no-snapshot",
    ],
    true,
  );
  assert.match(
    badCountsFailure.stderr,
    /restored invariants: Restored row counts differ/u,
  );
  await ready();
  assert.equal(readFileSync(stateFile, "utf8"), initialState);
  assert.equal(query("SELECT count(*) FROM pages"), "2");
  assert.equal(storageRead(sourceVolumes.storage), "after-backup-source-data");
  const readonlyOverlay = join(root, "readonly.yml");
  writeFileSync(
    readonlyOverlay,
    "services:\n  db:\n    entrypoint: [sh, -ceu, 'unset PGOPTIONS; exec docker-entrypoint.sh postgres']\n    environment:\n      PGOPTIONS: -c default_transaction_read_only=on\n",
  );
  const readonlyFailure = cli(
    "restore",
    archive,
    [
      "--yes",
      "--replace",
      "--no-start",
      "--maintenance-confirmed",
      "--no-snapshot",
      "--compose-file",
      readonlyOverlay,
    ],
    true,
  );
  assert.match(readonlyFailure.stderr, /database restore/u);
  await ready();
  assert.equal(readFileSync(stateFile, "utf8"), initialState);
  assert.equal(query("SELECT count(*) FROM pages"), "2");
  const wrongImage = join(root, "wrong-image.tar");
  mutateManifest(wrongImage, (manifest) => {
    manifest.application.image = "other-image@sha256:" + "0".repeat(64);
  });
  cli(
    "restore",
    wrongImage,
    ["--yes", "--replace", "--no-start", "--maintenance-confirmed"],
    true,
  );
  assert.equal(query("SELECT count(*) FROM pages"), "2");
  console.log(
    "backup-e2e: successful candidate restore and independently retained source/snapshot",
  );
  const restored = cli("restore", archive, [
    "--yes",
    "--replace",
    "--no-start",
    "--maintenance-confirmed",
  ]);
  assert.equal(restored.started, false);
  assert.notEqual(restored.volumes.database, sourceVolumes.database);
  assert.equal(query("SELECT count(*) FROM pages"), "1");
  assert.equal(storageRead(restored.volumes.storage), "before-backup");
  run("docker", [
    "run",
    "--rm",
    "--user",
    "1000:1000",
    "-v",
    `${restored.volumes.storage}:/data`,
    postgres,
    "sh",
    "-ceu",
    'test "$(cat /data/private/nested/private.txt)" = restricted; printf writable > /data/private/nested/private.txt; printf created > /data/private/nested/new.txt; rm /data/private/nested/new.txt; test "$(stat -c %a /data/private/nested/private.txt)" = 600',
  ]);
  assert.equal(storageRead(sourceVolumes.storage), "after-backup-source-data");
  assert.equal(readFileSync(restored.rollbackStateFile, "utf8"), initialState);
  assert.match(
    readFileSync(stateFile, "utf8"),
    /RESTORE_PHASE=awaiting-acceptance/u,
  );
  for (const line of initialState
    .trim()
    .split("\n")
    .filter((line) =>
      /^(?:MIGRATION_PHASE|DOCMOST_IMAGE|POSTGRES_IMAGE)=/u.test(line),
    ))
    assert.ok(readFileSync(stateFile, "utf8").split("\n").includes(line));
  assert.equal(readFileSync(runtime, "utf8"), runtimeBefore);
  assert.equal(readFileSync(override, "utf8"), overrideBefore);
  assert.equal(
    compose("exec", "-T", "redis", "redis-cli", "DBSIZE").stdout.trim(),
    "0",
  );
  assert.ok(
    !compose("ps", "--status", "running", "--services").stdout.includes(
      "docmost",
    ),
  );
  assert.equal(
    cli("verify", restored.snapshotArchive).manifest.database.counts.pages,
    2,
  );
  for (const name of Object.values(sourceVolumes))
    run("docker", ["volume", "inspect", name]);
  cli("create", join(root, "pending-acceptance.tar"), ["--yes"], true);
  console.log(
    "backup-e2e: cold restore creates only fresh candidate external volumes",
  );
  compose("down", "--remove-orphans");
  const coldSources = {
    database: `${project}-cold-db`,
    storage: `${project}-cold-storage`,
    redis: `${project}-cold-redis`,
  };
  writeFileSync(
    stateFile,
    `POSTGRES_VOLUME_NAME=${coldSources.database}\nDOCMOST_STORAGE_VOLUME_NAME=${coldSources.storage}\nREDIS_VOLUME_NAME=${coldSources.redis}\nMIGRATION_PHASE=ready\n`,
  );
  const cold = cli("restore", archive, [
    "--yes",
    "--replace",
    "--no-start",
    "--maintenance-confirmed",
    "--no-snapshot",
  ]);
  assert.equal(cold.status, "restored");
  assert.equal(query("SELECT count(*) FROM pages"), "1");
  for (const name of Object.values(coldSources))
    assert.notEqual(
      spawnSync("docker", ["volume", "inspect", name], { stdio: "ignore" })
        .status,
      0,
    );
  console.log(
    JSON.stringify({
      result: "PASS",
      scope:
        "production Compose plus canonical Typesense and synthetic lifecycle fixture overlay; real PostgreSQL, Redis, storage and external volumes; no application acceptance claimed",
      isolatedProject: project,
      publishedPorts: 0,
      sourceVolumesRetained: true,
      candidateRestoreValidated: true,
      invariantFailureRollback: true,
      preRestoreSnapshotVerified: true,
      relativePathsAndInputPrecedence: true,
      hostPermissions: {
        platform: process.platform,
        uid: process.getuid?.(),
        gid: process.getgid?.(),
        privateOperatorOwnedArchive: Boolean(process.getuid),
      },
    }),
  );
  passed = true;
} finally {
  if (created) {
    compose("down", "--remove-orphans");
    const candidates = run("docker", [
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=com.docmost.restore=${project}`,
    ])
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    for (const name of [
      ...Object.values(sourceVolumes),
      typesenseVolume,
      ...candidates,
    ]) {
      assert.ok(
        name.startsWith(project),
        "cleanup must stay within the test namespace",
      );
      run("docker", ["volume", "rm", name]);
    }
    run("docker", ["network", "rm", `${project}-edge`]);
  }
  assert.ok(
    basename(root).startsWith("docmost-backup-e2e-") &&
      root.startsWith(tmpdir()),
    "cleanup must stay within the owned temporary root",
  );
  if (passed) rmSync(root, { recursive: true, force: true });
  else
    console.error(`Synthetic fixture inputs retained for diagnosis: ${root}`);
}
