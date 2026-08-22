import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKUP_SCHEMA,
  assertSafeTarEntries,
  detectBackupFormat,
  parseEnvFile,
  parseTarListings,
  payloadDescriptor,
  readLegacyAppSecret,
  replaceEnvValue,
  storageInventoryFromNullDelimited,
  storageInventoryFromTarEntries,
  validateManifest,
} from "./backup-lib.mjs";

const HELPER_IMAGE =
  "postgres:18@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636";
const SAFE_DOCKER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const DEFAULT_COMPOSE_FILE = "docker-compose.yml";
const DEFAULT_ENV_FILE = ".env";

function usage() {
  return `Usage:
  corepack pnpm backup -- create --archive ABSOLUTE_PATH [options]
  corepack pnpm backup -- verify --archive PATH [--json]
  corepack pnpm backup -- restore --archive PATH --replace --yes [options]

Options:
  --compose-file PATH      Default: ${DEFAULT_COMPOSE_FILE}
  --env-file PATH          Default: ${DEFAULT_ENV_FILE}
  --snapshot-archive PATH  Pre-restore snapshot target
  --no-snapshot            Explicitly discard the current Compose data
  --allow-legacy-env       Import only APP_SECRET from a legacy archive
  --no-start               Leave only PostgreSQL and Redis running after restore
  --replace                Confirm replacement of the resolved Compose volumes
  --yes                    Confirm a state-changing operation
  --json                   Print machine-readable output`;
}

export function parseArguments(argv) {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const options = {
    command: normalizedArgv[0],
    composeFile: DEFAULT_COMPOSE_FILE,
    envFile: DEFAULT_ENV_FILE,
    archive: undefined,
    snapshotArchive: undefined,
    noSnapshot: false,
    allowLegacyEnv: false,
    noStart: false,
    replace: false,
    yes: false,
    json: false,
  };
  for (let index = 1; index < normalizedArgv.length; index += 1) {
    const argument = normalizedArgv[index];
    if (argument === "--no-snapshot") options.noSnapshot = true;
    else if (argument === "--allow-legacy-env") options.allowLegacyEnv = true;
    else if (argument === "--no-start") options.noStart = true;
    else if (argument === "--replace") options.replace = true;
    else if (argument === "--yes") options.yes = true;
    else if (argument === "--json") options.json = true;
    else if (
      [
        "--archive",
        "--compose-file",
        "--env-file",
        "--snapshot-archive",
      ].includes(argument)
    ) {
      const value = normalizedArgv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      const key = {
        "--archive": "archive",
        "--compose-file": "composeFile",
        "--env-file": "envFile",
        "--snapshot-archive": "snapshotArchive",
      }[argument];
      options[key] = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: options.encoding === null ? null : "utf8",
    maxBuffer: options.maxBuffer || 512 * 1024 * 1024,
    cwd: options.cwd,
    env: options.env,
    input: options.input,
  });
  if (result.error) throw result.error;
  const allowedStatuses = options.allowedStatuses || [0];
  if (!allowedStatuses.includes(result.status)) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr;
    const stdout = Buffer.isBuffer(result.stdout)
      ? result.stdout.toString("utf8")
      : result.stdout;
    const detail = (stderr || stdout || "").trim().slice(0, 1000);
    throw new Error(
      `${binary} ${args[0] || ""} failed with exit ${result.status}${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
  return result;
}

function streamProcess(binary, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [
        options.inputPath ? "pipe" : "ignore",
        options.outputPath ? "pipe" : "inherit",
        "pipe",
      ],
    });
    const errors = [];
    let errorBytes = 0;
    let childClosed = false;
    let outputFinished = !options.outputPath;
    const finish = () => {
      if (childClosed && outputFinished) resolvePromise();
    };
    child.stderr.on("data", (chunk) => {
      if (errorBytes < 1024 * 1024) {
        errors.push(chunk);
        errorBytes += chunk.length;
      }
    });
    let input;
    let output;
    if (options.inputPath) {
      input = createReadStream(options.inputPath);
      input.on("error", reject);
      input.pipe(child.stdin);
    }
    if (options.outputPath) {
      output = createWriteStream(options.outputPath, {
        flags: "wx",
        mode: 0o600,
      });
      output.on("error", reject);
      output.on("finish", () => {
        outputFinished = true;
        finish();
      });
      child.stdout.pipe(output);
    }
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) {
        reject(
          new Error(
            `${binary} ${args[0] || ""} failed with exit ${status}: ${Buffer.concat(
              errors,
            )
              .toString("utf8")
              .trim()
              .slice(0, 1000)}`,
          ),
        );
      } else {
        childClosed = true;
        finish();
      }
    });
  });
}

function composeArgs(context, ...args) {
  return [
    "compose",
    "--env-file",
    context.envFile,
    "-f",
    context.composeFile,
    ...args,
  ];
}

export function postRestoreAnalyzeArgs(context, user, database) {
  return composeArgs(
    context,
    "exec",
    "-T",
    "db",
    "vacuumdb",
    "--analyze-in-stages",
    "-U",
    user,
    "-d",
    database,
  );
}

function compose(context, args, options = {}) {
  return run("docker", composeArgs(context, ...args), options);
}

function assertAbsoluteArchivePath(path, repositoryRoot, mustNotExist = false) {
  if (!path || !isAbsolute(path)) {
    throw new Error("--archive must be an explicit absolute path");
  }
  const absolute = resolve(path);
  const fromRepository = relative(repositoryRoot, absolute);
  if (
    absolute === resolve(absolute, "/") ||
    fromRepository === "" ||
    (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))
  ) {
    throw new Error("Backup archive must be outside the repository");
  }
  if (mustNotExist && existsSync(absolute)) {
    throw new Error(`Backup archive already exists: ${absolute}`);
  }
  return absolute;
}

function assertSafeDockerName(name, label) {
  if (!SAFE_DOCKER_NAME.test(name || "")) {
    throw new Error(`${label} is not a safe Docker resource name`);
  }
}

function createContext(options, requireEnvironment = true) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const composeFile = resolve(options.composeFile);
  const envFile = resolve(options.envFile);
  if (!existsSync(composeFile)) {
    throw new Error(`Compose file is missing: ${composeFile}`);
  }
  if (requireEnvironment && !existsSync(envFile)) {
    throw new Error(`Environment file is missing: ${envFile}`);
  }
  return {
    repositoryRoot,
    composeFile,
    envFile,
    environment: existsSync(envFile)
      ? parseEnvFile(readFileSync(envFile, "utf8"))
      : {},
  };
}

function composeConfig(context) {
  return JSON.parse(compose(context, ["config", "--format", "json"]).stdout);
}

function resolveComposeResources(context) {
  const config = composeConfig(context);
  const volumeForTarget = (service, target) => {
    const source = config.services?.[service]?.volumes?.find(
      (mount) => mount.type === "volume" && mount.target === target,
    )?.source;
    return source ? config.volumes?.[source]?.name : undefined;
  };
  const volumes = {
    database: volumeForTarget("db", "/var/lib/postgresql"),
    storage: volumeForTarget("docmost", "/app/data/storage"),
    redis: volumeForTarget("redis", "/data"),
  };
  for (const [label, name] of Object.entries(volumes)) {
    assertSafeDockerName(name, `${label} volume`);
  }
  for (const service of ["db", "redis", "docmost", "collab"]) {
    if (!config.services?.[service]) {
      throw new Error(`Compose service is required: ${service}`);
    }
  }
  return { config, volumes };
}

function helperMount(path, target, readOnly = false) {
  return `${resolve(path)}:${target}${readOnly ? ":ro" : ""}`;
}

function listTar(path, gzip = false) {
  const inputDirectory = dirname(path);
  const member = basename(path);
  const base = [
    "run",
    "--rm",
    "-v",
    helperMount(inputDirectory, "/input", true),
    HELPER_IMAGE,
    "tar",
  ];
  const names = run("docker", [
    ...base,
    gzip ? "-tzf" : "-tf",
    `/input/${member}`,
  ]).stdout;
  const verbose = run("docker", [
    ...base,
    gzip ? "-tvzf" : "-tvf",
    `/input/${member}`,
  ]).stdout;
  return parseTarListings(names, verbose);
}

function extractSelectedTar(path, outputDirectory, members) {
  const inputDirectory = dirname(path);
  const args = [
    "run",
    "--rm",
    "-v",
    helperMount(inputDirectory, "/input", true),
    "-v",
    helperMount(outputDirectory, "/output"),
    HELPER_IMAGE,
    "tar",
    "--extract",
    "--file",
    `/input/${basename(path)}`,
    "--directory",
    "/output",
    "--no-same-owner",
    "--no-same-permissions",
    ...members,
  ];
  run("docker", args);
}

function validatePostgresDump(path) {
  const directory = dirname(path);
  const file = basename(path);
  const prefix = [
    "run",
    "--rm",
    "-v",
    helperMount(directory, "/work", true),
    HELPER_IMAGE,
    "pg_restore",
  ];
  const list = run("docker", [...prefix, "--list", `/work/${file}`]).stdout;
  run("docker", [...prefix, "--file=/dev/null", `/work/${file}`]);
  const databaseVersion = /^;\s*Dumped from database version:\s*(.+)$/mu.exec(
    list,
  )?.[1];
  const dumpVersion = /^;\s*Dumped by pg_dump version:\s*(.+)$/mu.exec(
    list,
  )?.[1];
  const tocEntries = list
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith(";")).length;
  return { databaseVersion, dumpVersion, tocEntries };
}

async function verifyArchive(path, repositoryRoot) {
  const archive = assertAbsoluteArchivePath(path, repositoryRoot, false);
  if (!existsSync(archive) || !statSync(archive).isFile()) {
    throw new Error(`Backup archive is missing: ${archive}`);
  }
  const outerEntries = listTar(archive, false);
  const format = detectBackupFormat(outerEntries);
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "docmost-backup-verify-"),
  );
  try {
    const selected = outerEntries
      .filter((entry) => entry.type === "-")
      .map((entry) => entry.path);
    extractSelectedTar(archive, temporaryDirectory, selected);
    const postgresDump = join(temporaryDirectory, "postgres.dump");
    const database = validatePostgresDump(postgresDump);
    const storageMember = format === "v1" ? "storage.tar.gz" : "storage.tar";
    const storageArchive = join(temporaryDirectory, storageMember);
    const storageEntries = listTar(storageArchive, format === "v1");
    const normalizedStoragePaths = assertSafeTarEntries(storageEntries, {
      legacyStorage: format === "legacy",
    });
    let manifest;
    if (format === "v1") {
      manifest = validateManifest(
        JSON.parse(
          readFileSync(join(temporaryDirectory, "manifest.json"), "utf8"),
        ),
      );
      for (const member of ["postgres.dump", "storage.tar.gz"]) {
        const actual = await payloadDescriptor(
          join(temporaryDirectory, member),
        );
        const expected = manifest.payloads[member];
        if (
          actual.bytes !== expected.bytes ||
          actual.sha256 !== expected.sha256
        ) {
          throw new Error(`Backup payload checksum mismatch: ${member}`);
        }
      }
      const actualStorage = storageInventoryFromTarEntries(storageEntries);
      for (const key of ["fileCount", "totalBytes", "pathSetSha256"]) {
        if (actualStorage[key] !== manifest.storage?.[key]) {
          throw new Error(`Backup storage inventory mismatch: ${key}`);
        }
      }
    }
    return {
      archive,
      format,
      database,
      storage: {
        entries: storageEntries.length,
        regularFiles: storageEntries.filter((entry) => entry.type === "-")
          .length,
        normalizedPaths: normalizedStoragePaths.length,
      },
      manifest,
      temporaryDirectory,
      postgresDump,
      storageArchive,
      legacyEnv:
        format === "legacy" ? join(temporaryDirectory, ".env") : undefined,
    };
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

function sanitizedVerification(result) {
  return {
    status: "verified",
    archive: result.archive,
    format: result.format,
    database: result.database,
    storage: result.storage,
    manifest: result.manifest || undefined,
  };
}

function psql(context, sql) {
  const user = context.environment.POSTGRES_USER || "docmost";
  const database = context.environment.POSTGRES_DB || "docmost";
  return compose(context, [
    "exec",
    "-T",
    "db",
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    user,
    "-d",
    database,
    "-At",
    "-c",
    sql,
  ]).stdout.trim();
}

async function waitForNoApplicationConnections(context) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const count = Number(
      psql(
        context,
        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();",
      ),
    );
    if (count === 0) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error("Application database connections did not drain");
}

function databaseInventory(context) {
  const queries = {
    users: "SELECT count(*) FROM users;",
    spaces: "SELECT count(*) FROM spaces;",
    pages: "SELECT count(*) FROM pages;",
    attachments: "SELECT count(*) FROM attachments;",
    migrations: "SELECT count(*) FROM kysely_migration;",
    latestMigration:
      "SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1;",
  };
  return {
    users: Number(psql(context, queries.users)),
    spaces: Number(psql(context, queries.spaces)),
    pages: Number(psql(context, queries.pages)),
    attachments: Number(psql(context, queries.attachments)),
    migrationCount: Number(psql(context, queries.migrations)),
    latestMigration: psql(context, queries.latestMigration),
  };
}

function storageInventory(volume) {
  const result = run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${volume}:/source:ro`,
      HELPER_IMAGE,
      "sh",
      "-ceu",
      "cd /source; find . -type f -printf '%P\\0%s\\0'",
    ],
    { encoding: null },
  );
  return storageInventoryFromNullDelimited(result.stdout);
}

function runningServices(context) {
  return compose(context, ["ps", "--status", "running", "--services"])
    .stdout.split(/\r?\n/u)
    .filter(Boolean);
}

async function createBackup(options, providedContext) {
  const context = providedContext || createContext(options);
  const archive = assertAbsoluteArchivePath(
    options.archive,
    context.repositoryRoot,
    true,
  );
  if ((context.environment.STORAGE_DRIVER || "local") !== "local") {
    throw new Error("Compose backup supports only STORAGE_DRIVER=local");
  }
  const { config, volumes } = resolveComposeResources(context);
  const runningBefore = runningServices(context);
  for (const service of ["db", "redis"]) {
    if (!runningBefore.includes(service)) {
      throw new Error(`${service} must be running before backup creation`);
    }
  }
  const temporaryDirectory = `${archive}.work-${process.pid}`;
  if (existsSync(temporaryDirectory)) {
    throw new Error(
      `Temporary backup path already exists: ${temporaryDirectory}`,
    );
  }
  run("docker", [
    "run",
    "--rm",
    "-v",
    helperMount(dirname(archive), "/output"),
    HELPER_IMAGE,
    "mkdir",
    "-m",
    "700",
    `/output/${basename(temporaryDirectory)}`,
  ]);
  const stoppedWriters = ["docmost", "collab"].filter((service) =>
    runningBefore.includes(service),
  );
  let partial;
  try {
    if (stoppedWriters.length > 0)
      compose(context, ["stop", ...stoppedWriters]);
    await waitForNoApplicationConnections(context);
    const dumpPath = join(temporaryDirectory, "postgres.dump");
    const user = context.environment.POSTGRES_USER || "docmost";
    const database = context.environment.POSTGRES_DB || "docmost";
    await streamProcess(
      "docker",
      composeArgs(
        context,
        "exec",
        "-T",
        "db",
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "-U",
        user,
        "-d",
        database,
      ),
      { outputPath: dumpPath },
    );
    const storageArchive = join(temporaryDirectory, "storage.tar.gz");
    run("docker", [
      "run",
      "--rm",
      "-v",
      `${volumes.storage}:/source:ro`,
      "-v",
      helperMount(temporaryDirectory, "/work"),
      HELPER_IMAGE,
      "tar",
      "-czf",
      "/work/storage.tar.gz",
      "-C",
      "/source",
      ".",
    ]);
    const inventory = databaseInventory(context);
    const storage = storageInventory(volumes.storage);
    const databaseValidation = validatePostgresDump(dumpPath);
    const manifest = {
      schema: BACKUP_SCHEMA,
      createdAt: new Date().toISOString(),
      application: {
        version: JSON.parse(
          readFileSync(join(context.repositoryRoot, "package.json"), "utf8"),
        ).version,
        revision: run("git", ["rev-parse", "HEAD"], {
          cwd: context.repositoryRoot,
        }).stdout.trim(),
        image: config.services.docmost.image,
      },
      database: {
        ...databaseValidation,
        migrationCount: inventory.migrationCount,
        latestMigration: inventory.latestMigration,
        counts: {
          users: inventory.users,
          spaces: inventory.spaces,
          pages: inventory.pages,
          attachments: inventory.attachments,
        },
      },
      storage: { driver: "local", ...storage },
      payloads: {
        "postgres.dump": await payloadDescriptor(dumpPath),
        "storage.tar.gz": await payloadDescriptor(storageArchive),
      },
      secrets: {
        included: false,
        required: ["APP_SECRET", "COLLAB_INTERNAL_SECRET", "POSTGRES_PASSWORD"],
      },
      redis: { included: false, restore: "fresh" },
    };
    writeFileSync(
      join(temporaryDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    partial = `${archive}.part-${process.pid}`;
    run("docker", [
      "run",
      "--rm",
      "-v",
      helperMount(dirname(archive), "/output"),
      HELPER_IMAGE,
      "tar",
      "-cf",
      `/output/${basename(partial)}`,
      "-C",
      `/output/${basename(temporaryDirectory)}`,
      "manifest.json",
      "postgres.dump",
      "storage.tar.gz",
    ]);
    const verified = await verifyArchive(partial, context.repositoryRoot);
    rmSync(verified.temporaryDirectory, { recursive: true, force: true });
    renameSync(partial, archive);
    return {
      status: "created",
      archive,
      manifest,
      stoppedWriters,
    };
  } finally {
    if (existsSync(temporaryDirectory)) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
    if (partial && existsSync(partial)) {
      rmSync(partial, { force: true });
    }
    if (stoppedWriters.length > 0) {
      compose(context, ["up", "-d", ...stoppedWriters]);
    }
  }
}

async function waitForDatabase(context) {
  const user = context.environment.POSTGRES_USER || "docmost";
  const database = context.environment.POSTGRES_DB || "docmost";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = compose(
      context,
      ["exec", "-T", "db", "pg_isready", "-U", user, "-d", database],
      { allowedStatuses: [0, 1, 2] },
    );
    if (result.status === 0) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error("PostgreSQL did not become ready");
}

function removeResolvedVolumes(volumes) {
  for (const name of Object.values(volumes)) {
    assertSafeDockerName(name, "Compose volume");
    const inspected = run("docker", ["volume", "inspect", name], {
      allowedStatuses: [0, 1],
    });
    if (inspected.status === 0) run("docker", ["volume", "rm", name]);
  }
}

async function restoreBackup(options) {
  if (!options.yes || !options.replace) {
    throw new Error("restore requires both --replace and --yes");
  }
  if (options.noSnapshot && options.snapshotArchive) {
    throw new Error(
      "--no-snapshot and --snapshot-archive are mutually exclusive",
    );
  }
  const context = createContext(options);
  const verified = await verifyArchive(options.archive, context.repositoryRoot);
  const { volumes } = resolveComposeResources(context);
  let snapshot;
  let candidateCreated = false;
  let legacyAppSecret;
  try {
    if (verified.format === "legacy") {
      if (!options.allowLegacyEnv) {
        throw new Error(
          "Legacy restore requires --allow-legacy-env to import only APP_SECRET",
        );
      }
      legacyAppSecret = readLegacyAppSecret(
        readFileSync(verified.legacyEnv, "utf8"),
      );
    }
    if (!options.noSnapshot) {
      const defaultSnapshot = join(
        dirname(verified.archive),
        `docmost-pre-restore-${new Date().toISOString().replace(/[:.]/gu, "-")}.tar`,
      );
      const snapshotArchive = options.snapshotArchive || defaultSnapshot;
      snapshot = await createBackup(
        { ...options, archive: snapshotArchive },
        context,
      );
    }
    if (legacyAppSecret) {
      const currentEnv = readFileSync(context.envFile, "utf8");
      const nextEnv = replaceEnvValue(
        currentEnv,
        "APP_SECRET",
        legacyAppSecret,
      );
      const temporaryEnv = `${context.envFile}.tmp-${process.pid}`;
      const descriptor = openSync(temporaryEnv, "wx", 0o600);
      try {
        writeFileSync(descriptor, nextEnv, "utf8");
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporaryEnv, context.envFile);
      context.environment = parseEnvFile(nextEnv);
    }
    compose(context, ["down", "--remove-orphans"]);
    removeResolvedVolumes(volumes);
    candidateCreated = true;
    compose(context, ["up", "-d", "db", "redis"]);
    await waitForDatabase(context);
    const user = context.environment.POSTGRES_USER || "docmost";
    const database = context.environment.POSTGRES_DB || "docmost";
    await streamProcess(
      "docker",
      composeArgs(
        context,
        "exec",
        "-T",
        "db",
        "pg_restore",
        "--exit-on-error",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "-U",
        user,
        "-d",
        database,
      ),
      { inputPath: verified.postgresDump },
    );
    run("docker", postRestoreAnalyzeArgs(context, user, database));
    const storageVolume = run(
      "docker",
      ["volume", "inspect", volumes.storage],
      {
        allowedStatuses: [0, 1],
      },
    );
    if (storageVolume.status !== 0) {
      compose(context, ["create", "docmost"]);
    }
    const extraction =
      verified.format === "legacy"
        ? [
            "tar",
            "-xf",
            "/input/storage.tar",
            "-C",
            "/target",
            "--strip-components=1",
            "--no-same-owner",
            "--no-same-permissions",
          ]
        : [
            "tar",
            "-xzf",
            "/input/storage.tar.gz",
            "-C",
            "/target",
            "--no-same-owner",
            "--no-same-permissions",
          ];
    run("docker", [
      "run",
      "--rm",
      "-v",
      helperMount(dirname(verified.storageArchive), "/input", true),
      "-v",
      `${volumes.storage}:/target`,
      HELPER_IMAGE,
      ...extraction,
    ]);
    compose(context, ["rm", "-f", "docmost", "collab"]);
    if (!options.noStart) compose(context, ["up", "-d"]);
    return {
      status: "restored",
      archive: verified.archive,
      format: verified.format,
      snapshotArchive: snapshot?.archive,
      started: !options.noStart,
      volumes,
      redis: "fresh",
    };
  } catch (error) {
    if (candidateCreated) {
      compose(context, ["down", "--remove-orphans"], {
        allowedStatuses: [0, 1],
      });
      removeResolvedVolumes(volumes);
    }
    throw error;
  } finally {
    rmSync(verified.temporaryDirectory, { recursive: true, force: true });
  }
}

function printResult(result, json) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Status: ${result.status}`);
    if (result.archive) console.log(`Archive: ${result.archive}`);
    if (result.format) console.log(`Format: ${result.format}`);
    if (result.database) {
      console.log(`PostgreSQL TOC entries: ${result.database.tocEntries}`);
    }
    if (result.storage) {
      console.log(`Storage regular files: ${result.storage.regularFiles}`);
    }
    if (result.snapshotArchive) {
      console.log(`Pre-restore snapshot: ${result.snapshotArchive}`);
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.command || ["help", "--help", "-h"].includes(options.command)) {
    console.log(usage());
    return;
  }
  if (!options.archive) throw new Error("--archive is required");
  if (options.command === "verify") {
    const context = createContext(options, false);
    const verified = await verifyArchive(
      options.archive,
      context.repositoryRoot,
    );
    try {
      printResult(sanitizedVerification(verified), options.json);
    } finally {
      rmSync(verified.temporaryDirectory, { recursive: true, force: true });
    }
    return;
  }
  if (options.command === "create") {
    if (!options.yes) throw new Error("create requires --yes");
    printResult(await createBackup(options), options.json);
    return;
  }
  if (options.command === "restore") {
    printResult(await restoreBackup(options), options.json);
    return;
  }
  throw new Error(`Unknown command: ${options.command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Backup operation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
