import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { POSTGRES_IMAGE } from "./production-db.mjs";

const ALPINE_POSTGRES_IMAGE =
  "postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const REDIS_IMAGE =
  "redis:8@sha256:344e3945a0b431c8ff1eecd58c5573538126bd756f02fc7e218ddf1fc2546366";
const DATABASE_NAME = "docmost";
const DATABASE_USER = "docmost";
const DATABASE_PASSWORD = "ci-runtime-migration-password";
const PREFLIGHT_SCRIPT =
  "apps/server/dist/apps/server/src/database/preflight.js";
const MIGRATION_SCRIPT =
  "apps/server/dist/apps/server/src/database/migrate-latest.js";
const SAFE_OUTPUT_LIMIT = 800;

function parseArguments(argv) {
  const imageIndex = argv.indexOf("--app-image");
  const appImage = imageIndex >= 0 ? argv[imageIndex + 1] : undefined;
  if (!appImage) throw new Error("--app-image is required");
  return { appImage };
}

function command(binary, args, options = {}) {
  const allowedStatuses = options.allowedStatuses ?? [0];
  const result = spawnSync(binary, args, {
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    input: options.input,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!allowedStatuses.includes(result.status)) {
    const detail = String(result.stderr || result.stdout || "")
      .trim()
      .slice(0, SAFE_OUTPUT_LIMIT);
    throw new Error(
      `${binary} ${args[0] || ""} failed with exit ${result.status}${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
  return result;
}

function waitForPostgres(container, timeoutSeconds = 120) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const result = command(
      "docker",
      [
        "exec",
        container,
        "sh",
        "-ceu",
        'test "$(cat /proc/1/comm)" = postgres && pg_isready -U "$1" -d "$2"',
        "docmost-readiness",
        DATABASE_USER,
        DATABASE_NAME,
      ],
      { allowedStatuses: [0, 1, 2, 3] },
    );
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`PostgreSQL container ${container} did not become ready`);
}

function waitForCommand(container, args, timeoutSeconds = 120) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const result = command("docker", ["exec", container, ...args], {
      allowedStatuses: [0, 1, 2, 3, 7, 22],
    });
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`Container ${container} did not pass its readiness command`);
}

function startPostgres({ container, volume, network, passwordFile, image }) {
  command("docker", [
    "run",
    "-d",
    "--name",
    container,
    "--network",
    network,
    "-e",
    `POSTGRES_DB=${DATABASE_NAME}`,
    "-e",
    `POSTGRES_USER=${DATABASE_USER}`,
    "-e",
    "POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password",
    "--mount",
    `type=volume,src=${volume},dst=/var/lib/postgresql`,
    "--mount",
    `type=bind,src=${passwordFile},dst=/run/secrets/postgres_password,readonly`,
    image,
  ]);
  waitForPostgres(container);
}

function databaseUrlFile(directory, container) {
  const path = join(directory, `${container}.url`);
  writeFileSync(
    path,
    `postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@${container}:5432/${DATABASE_NAME}\n`,
    { mode: 0o600 },
  );
  return path;
}

function runAppDatabaseCommand({
  appImage,
  network,
  databaseUrlPath,
  script,
  appSecretPath,
  arguments: extraArguments = [],
  allowedStatuses = [0],
}) {
  return command(
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
      `type=bind,src=${databaseUrlPath},dst=/run/secrets/database_url,readonly`,
      ...(appSecretPath
        ? [
            "-e",
            "APP_SECRET_FILE=/run/secrets/app_secret",
            "--mount",
            `type=bind,src=${appSecretPath},dst=/run/secrets/app_secret,readonly`,
          ]
        : []),
      "--entrypoint",
      "node",
      appImage,
      script,
      ...extraArguments,
    ],
    { allowedStatuses },
  );
}

function parseReport(source) {
  for (const line of source.split(/\r?\n/u).reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // Docker can add non-JSON progress output around a one-shot command.
    }
  }
  throw new Error("Preflight did not emit a JSON report");
}

function requireIssue(result, exitCode, issueCode) {
  const report = parseReport(result.stdout);
  if (
    report.exitCode !== exitCode ||
    !report.issues?.some((issue) => issue.code === issueCode)
  ) {
    throw new Error(
      `Preflight did not report ${issueCode} with exit ${exitCode}`,
    );
  }
  return report;
}

function psql(container, sql) {
  return command("docker", [
    "exec",
    container,
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    DATABASE_USER,
    "-d",
    DATABASE_NAME,
    "-At",
    "-c",
    sql,
  ]).stdout.trim();
}

function removeContainer(name) {
  command("docker", ["rm", "-f", name], { allowedStatuses: [0, 1] });
}

function removeVolume(name) {
  command("docker", ["volume", "rm", "-f", name], {
    allowedStatuses: [0, 1],
  });
}

function assertNoSecrets(output) {
  for (const secret of [
    DATABASE_PASSWORD,
    "ci-app-secret-at-least-32-characters",
    "ci-collaboration-secret-at-least-32-characters",
    `postgresql://${DATABASE_USER}:`,
    "DATABASE_URL=",
  ]) {
    if (output.includes(secret)) {
      throw new Error("Migration smoke output contains database credentials");
    }
  }
}

function main() {
  const { appImage } = parseArguments(process.argv.slice(2));
  const id = `docmost-pg-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const network = `${id}-network`;
  const sourceVolume = `${id}-source`;
  const negativeVolume = `${id}-negative`;
  const targetVolume = `${id}-target`;
  const interruptedVolume = `${id}-interrupted`;
  const source = `${id}-source-db`;
  const negative = `${id}-negative-db`;
  const target = `${id}-target-db`;
  const interrupted = `${id}-interrupted-db`;
  const redis = `${id}-redis`;
  const collaboration = `${id}-collab`;
  const api = `${id}-api`;
  const storageVolume = `${id}-storage`;
  const directory = mkdtempSync(join(tmpdir(), `${id}-`));
  chmodSync(directory, 0o700);
  const passwordFile = join(directory, "postgres-password");
  const dumpFile = join(directory, "database.dump");
  const corruptDumpFile = join(directory, "database.corrupt.dump");
  const appSecretFile = join(directory, "app-secret");
  const collaborationSecretFile = join(directory, "collaboration-secret");
  writeFileSync(passwordFile, `${DATABASE_PASSWORD}\n`, { mode: 0o600 });
  writeFileSync(appSecretFile, "ci-app-secret-at-least-32-characters\n", {
    mode: 0o600,
  });
  writeFileSync(
    collaborationSecretFile,
    "ci-collaboration-secret-at-least-32-characters\n",
    { mode: 0o600 },
  );
  const capturedOutput = [];
  let stage = "resource setup";

  command("docker", ["network", "create", network]);
  for (const volume of [
    sourceVolume,
    negativeVolume,
    interruptedVolume,
    storageVolume,
  ]) {
    command("docker", ["volume", "create", volume]);
  }

  try {
    stage = "source initialization";
    startPostgres({
      container: source,
      volume: sourceVolume,
      network,
      passwordFile,
      image: POSTGRES_IMAGE,
    });
    const sourceUrl = databaseUrlFile(directory, source);
    runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: sourceUrl,
      script: MIGRATION_SCRIPT,
      appSecretPath: appSecretFile,
    });
    psql(
      source,
      "CREATE TABLE public.production_migration_fixture(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO public.production_migration_fixture VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma'); CREATE INDEX production_migration_fixture_value_idx ON public.production_migration_fixture(value); ANALYZE public.production_migration_fixture",
    );

    stage = "negative physical-volume clone";
    command("docker", ["stop", "--time", "30", source]);
    command("docker", [
      "run",
      "--rm",
      "--mount",
      `type=volume,src=${sourceVolume},dst=/source,readonly`,
      "--mount",
      `type=volume,src=${negativeVolume},dst=/target`,
      "--entrypoint",
      "sh",
      POSTGRES_IMAGE,
      "-ceu",
      "cp -a /source/. /target/",
    ]);
    startPostgres({
      container: negative,
      volume: negativeVolume,
      network,
      passwordFile,
      image: ALPINE_POSTGRES_IMAGE,
    });
    const negativeUrl = databaseUrlFile(directory, negative);
    const negativeResult = runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: negativeUrl,
      script: PREFLIGHT_SCRIPT,
      allowedStatuses: [20],
    });
    capturedOutput.push(negativeResult.stdout, negativeResult.stderr);
    const negativeReport = parseReport(negativeResult.stdout);
    if (
      negativeReport.exitCode !== 20 ||
      !negativeReport.issues?.some(
        (issue) => issue.code === "postgres_runtime_mismatch",
      )
    ) {
      throw new Error("Alpine runtime was not blocked as a volume migration");
    }
    const blockedMigrationResult = runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: negativeUrl,
      script: MIGRATION_SCRIPT,
      appSecretPath: appSecretFile,
      allowedStatuses: [20],
    });
    requireIssue(blockedMigrationResult, 20, "postgres_runtime_mismatch");
    capturedOutput.push(
      blockedMigrationResult.stdout,
      blockedMigrationResult.stderr,
    );
    removeContainer(negative);
    command("docker", ["start", source]);
    waitForPostgres(source);

    stage = "source dump";
    const dumpResult = command(
      "docker",
      [
        "exec",
        source,
        "pg_dump",
        "-U",
        DATABASE_USER,
        "-d",
        DATABASE_NAME,
        "--format=custom",
        "--no-owner",
        "--no-acl",
      ],
      { encoding: null },
    );
    writeFileSync(dumpFile, dumpResult.stdout, { mode: 0o600 });
    const corruptLength = Math.max(1, Math.floor(dumpResult.stdout.length / 2));
    writeFileSync(
      corruptDumpFile,
      dumpResult.stdout.subarray(0, corruptLength),
      {
        mode: 0o600,
      },
    );
    stage = "corrupt dump validation";
    const corruptValidation = command(
      "docker",
      [
        "run",
        "--rm",
        "--mount",
        `type=bind,src=${directory},dst=/work,readonly`,
        "--entrypoint",
        "pg_restore",
        POSTGRES_IMAGE,
        "--list",
        "/work/database.corrupt.dump",
      ],
      { allowedStatuses: [1] },
    );
    capturedOutput.push(corruptValidation.stdout, corruptValidation.stderr);

    stage = "interrupted restore rejection";
    startPostgres({
      container: interrupted,
      volume: interruptedVolume,
      network,
      passwordFile,
      image: POSTGRES_IMAGE,
    });
    const interruptedRestore = command(
      "docker",
      [
        "exec",
        "-i",
        interrupted,
        "pg_restore",
        "-U",
        DATABASE_USER,
        "-d",
        DATABASE_NAME,
        "--exit-on-error",
        "--no-owner",
        "--no-acl",
      ],
      {
        input: readFileSync(corruptDumpFile),
        encoding: null,
        allowedStatuses: [1],
      },
    );
    capturedOutput.push(interruptedRestore.stdout, interruptedRestore.stderr);
    removeContainer(interrupted);
    removeVolume(interruptedVolume);

    stage = "clean target restore";
    command("docker", ["volume", "create", targetVolume]);
    startPostgres({
      container: target,
      volume: targetVolume,
      network,
      passwordFile,
      image: POSTGRES_IMAGE,
    });
    const restoreResult = command(
      "docker",
      [
        "exec",
        "-i",
        target,
        "pg_restore",
        "-U",
        DATABASE_USER,
        "-d",
        DATABASE_NAME,
        "--exit-on-error",
        "--no-owner",
        "--no-acl",
      ],
      { input: readFileSync(dumpFile), encoding: null },
    );
    capturedOutput.push(restoreResult.stdout, restoreResult.stderr);
    const targetUrl = databaseUrlFile(directory, target);
    stage = "target migration rerun";
    runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: targetUrl,
      script: MIGRATION_SCRIPT,
      appSecretPath: appSecretFile,
    });
    runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: targetUrl,
      script: MIGRATION_SCRIPT,
      appSecretPath: appSecretFile,
    });
    psql(target, "ANALYZE");
    const positiveResult = runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: targetUrl,
      script: PREFLIGHT_SCRIPT,
      arguments: ["--require-latest"],
    });
    capturedOutput.push(positiveResult.stdout, positiveResult.stderr);
    const positiveReport = parseReport(positiveResult.stdout);
    if (positiveReport.exitCode !== 0) {
      throw new Error("Restored Debian database failed preflight");
    }
    if (
      psql(
        source,
        "SELECT count(*) FROM public.production_migration_fixture",
      ) !== "3"
    ) {
      throw new Error("Source fixture count is unexpected");
    }
    if (
      psql(
        target,
        "SELECT count(*) FROM public.production_migration_fixture",
      ) !== "3"
    ) {
      throw new Error("Restored fixture count is unexpected");
    }
    if (
      psql(target, "SELECT count(*) FROM pg_index WHERE NOT indisvalid") !== "0"
    ) {
      throw new Error("Restored database contains invalid indexes");
    }

    stage = "unsupported role rejection";
    psql(target, "CREATE ROLE docmost_unexpected_login LOGIN");
    const roleResult = runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: targetUrl,
      script: PREFLIGHT_SCRIPT,
      arguments: ["--require-latest"],
      allowedStatuses: [30],
    });
    requireIssue(roleResult, 30, "unsupported_database_topology");
    capturedOutput.push(roleResult.stdout, roleResult.stderr);
    psql(target, "DROP ROLE docmost_unexpected_login");

    stage = "invalid index rejection";
    psql(
      target,
      "CREATE TABLE public.docmost_invalid_index_fixture(value integer NOT NULL); INSERT INTO public.docmost_invalid_index_fixture VALUES (1), (1)",
    );
    const invalidIndexCreation = command(
      "docker",
      [
        "exec",
        target,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        DATABASE_USER,
        "-d",
        DATABASE_NAME,
        "-c",
        "CREATE UNIQUE INDEX CONCURRENTLY docmost_invalid_index_fixture_idx ON public.docmost_invalid_index_fixture(value)",
      ],
      { allowedStatuses: [1] },
    );
    capturedOutput.push(
      invalidIndexCreation.stdout,
      invalidIndexCreation.stderr,
    );
    const invalidIndexResult = runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: targetUrl,
      script: PREFLIGHT_SCRIPT,
      arguments: ["--require-latest"],
      allowedStatuses: [30],
    });
    requireIssue(invalidIndexResult, 30, "invalid_indexes");
    capturedOutput.push(invalidIndexResult.stdout, invalidIndexResult.stderr);
    psql(
      target,
      "DROP INDEX IF EXISTS public.docmost_invalid_index_fixture_idx; DROP TABLE public.docmost_invalid_index_fixture",
    );

    stage = "unknown migration rejection";
    psql(
      target,
      "INSERT INTO public.kysely_migration(name, timestamp) VALUES ('99999999T999999-unknown-ci-migration', '9999999999999')",
    );
    const unknownMigrationResult = runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: targetUrl,
      script: PREFLIGHT_SCRIPT,
      arguments: ["--require-latest"],
      allowedStatuses: [40],
    });
    requireIssue(unknownMigrationResult, 40, "migration_history_invalid");
    capturedOutput.push(
      unknownMigrationResult.stdout,
      unknownMigrationResult.stderr,
    );
    psql(
      target,
      "DELETE FROM public.kysely_migration WHERE name = '99999999T999999-unknown-ci-migration'",
    );
    const recoveredResult = runAppDatabaseCommand({
      appImage,
      network,
      databaseUrlPath: targetUrl,
      script: PREFLIGHT_SCRIPT,
      arguments: ["--require-latest"],
    });
    if (parseReport(recoveredResult.stdout).exitCode !== 0) {
      throw new Error("Preflight did not recover after fault cleanup");
    }
    capturedOutput.push(recoveredResult.stdout, recoveredResult.stderr);

    for (const secretFile of [
      targetUrl,
      appSecretFile,
      collaborationSecretFile,
    ]) {
      chmodSync(secretFile, 0o444);
    }

    stage = "application startup";
    command("docker", [
      "run",
      "-d",
      "--name",
      redis,
      "--network",
      network,
      REDIS_IMAGE,
      "redis-server",
      "--appendonly",
      "no",
      "--maxmemory-policy",
      "noeviction",
    ]);
    waitForCommand(redis, ["redis-cli", "ping"]);
    const applicationArguments = [
      "--network",
      network,
      "--read-only",
      "--tmpfs",
      "/tmp",
      "-e",
      "NODE_ENV=production",
      "-e",
      "APP_URL=http://127.0.0.1:3000",
      "-e",
      "COLLAB_URL=http://127.0.0.1:3001",
      "-e",
      `COLLAB_INTERNAL_URL=http://${collaboration}:3001`,
      "-e",
      "APP_SECRET_FILE=/run/secrets/app_secret",
      "-e",
      "COLLAB_INTERNAL_SECRET_FILE=/run/secrets/collaboration_secret",
      "-e",
      "DATABASE_URL_FILE=/run/secrets/database_url",
      "-e",
      `REDIS_URL=redis://${redis}:6379`,
      "-e",
      "AUTH_RATE_LIMIT_STORAGE=redis",
      "-e",
      "DATABASE_MIGRATION_MODE=external",
      "-e",
      "DRAWIO_URL=https://embed.diagrams.net",
      "--mount",
      `type=bind,src=${appSecretFile},dst=/run/secrets/app_secret,readonly`,
      "--mount",
      `type=bind,src=${collaborationSecretFile},dst=/run/secrets/collaboration_secret,readonly`,
      "--mount",
      `type=bind,src=${targetUrl},dst=/run/secrets/database_url,readonly`,
      "--mount",
      `type=volume,src=${storageVolume},dst=/app/data/storage`,
      "--entrypoint",
      "node",
      appImage,
    ];
    command("docker", [
      "run",
      "-d",
      "--name",
      collaboration,
      ...applicationArguments,
      "apps/server/dist/apps/server/src/collaboration/server/collab-main.js",
    ]);
    waitForCommand(collaboration, [
      "curl",
      "-fsS",
      "http://127.0.0.1:3001/api/health",
    ]);
    command("docker", [
      "run",
      "-d",
      "--name",
      api,
      ...applicationArguments,
      "apps/server/dist/apps/server/src/main.js",
    ]);
    waitForCommand(api, ["curl", "-fsS", "http://127.0.0.1:3000/api/health"]);

    const summary = JSON.stringify({
      status: "passed",
      negativeRuntimeExitCode: negativeReport.exitCode,
      migrationBlockedOnWrongRuntime: true,
      positiveRuntime: positiveReport.database?.runtimeFamily,
      fixtureRows: 3,
      corruptedDumpRejected: true,
      interruptedRestoreRejected: true,
      migrationRerunPassed: true,
      unknownMigrationRejected: true,
      invalidIndexRejected: true,
      extraLoginRoleRejected: true,
      collaborationHealthy: true,
      apiHealthy: true,
    });
    assertNoSecrets(`${capturedOutput.join("\n")}\n${summary}`);
    console.log(summary);
  } catch (error) {
    throw new Error(`${stage}: ${error.message}`);
  } finally {
    for (const container of [
      api,
      collaboration,
      redis,
      source,
      negative,
      target,
      interrupted,
    ]) {
      removeContainer(container);
    }
    for (const volume of [
      sourceVolume,
      negativeVolume,
      targetVolume,
      interruptedVolume,
      storageVolume,
    ]) {
      removeVolume(volume);
    }
    command("docker", ["network", "rm", network], {
      allowedStatuses: [0, 1],
    });
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      `PostgreSQL runtime migration smoke failed: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
