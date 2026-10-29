import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_SCHEMA,
  assertSafeTarEntries,
  detectBackupFormat,
  parseTarListings,
  readLegacyAppSecret,
  replaceEnvValue,
  storageInventoryFromNullDelimited,
  storageInventoryFromTarEntries,
  validateManifest,
} from "./backup-lib.mjs";
import {
  parseArguments,
  postRestoreAnalyzeArgs,
  composeArgs,
  createContext,
  candidateVolumeNames,
  imageProvenance,
  importLegacySecret,
  streamProcess,
} from "./backup.mjs";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withDeploymentLock } from "./deployment-lock.mjs";

test("owns streamed backup files privately and refuses to overwrite them", async () => {
  const root = mkdtempSync(join(tmpdir(), "docmost-stream-output-test-"));
  const output = join(root, "synthetic.dump");
  try {
    await streamProcess(
      process.execPath,
      ["-e", "process.stdout.write('synthetic backup payload')"],
      { outputPath: output },
    );
    assert.equal(readFileSync(output, "utf8"), "synthetic backup payload");
    if (process.getuid) {
      const metadata = statSync(output);
      assert.equal(metadata.uid, process.getuid());
      assert.equal(metadata.gid, process.getgid());
      assert.equal(metadata.mode & 0o777, 0o600);
    }
    await assert.rejects(
      streamProcess(process.execPath, ["-e", "process.stdout.write('other')"], {
        outputPath: output,
      }),
      { code: "EEXIST" },
    );
    assert.equal(readFileSync(output, "utf8"), "synthetic backup payload");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reaps an early failed restore reader without an unhandled EPIPE", async () => {
  const root = mkdtempSync(join(tmpdir(), "docmost-stream-test-"));
  const input = join(root, "synthetic.dump");
  writeFileSync(input, Buffer.alloc(2 * 1024 * 1024, 65));
  try {
    await assert.rejects(
      streamProcess(
        process.execPath,
        ["-e", "process.stdin.destroy(); process.exit(9)"],
        { inputPath: input },
      ),
      /exit 9/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps application image identity independent of the operator checkout", () => {
  const result = imageProvenance({
    Id: "sha256:fixture-image",
    Config: {
      Labels: {
        "org.opencontainers.image.version": "2.0.0",
        "org.opencontainers.image.revision": "fixture-application-revision",
      },
    },
  });
  assert.equal(result.revision, "fixture-application-revision");
  assert.equal(result.version, "2.0.0");
  assert.equal(
    imageProvenance({ Id: "sha256:fixture-no-labels" }).revision,
    "unknown",
  );
});

test("serializes backup and migration operations without stealing an existing lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "docmost-lock-test-"));
  const state = join(root, "state.env");
  writeFileSync(state, "MIGRATION_PHASE=accepted\n");
  try {
    await withDeploymentLock(state, "backup", async () => {
      await assert.rejects(
        withDeploymentLock(state, "migrate", async () =>
          assert.fail("must not run"),
        ),
        /locked/u,
      );
    });
    await withDeploymentLock(state, "migrate", async () => {});
    writeFileSync(`${state}.operation.lock`, "existing-owner");
    await assert.rejects(
      withDeploymentLock(state, "backup", async () => {}),
      /locked/u,
    );
    assert.equal(
      readFileSync(`${state}.operation.lock`, "utf8"),
      "existing-owner",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preserves ordered Compose and env inputs with state last", () => {
  const options = parseArguments([
    "create",
    "--env-file",
    "runtime.env",
    "--compose-file",
    "release.yml",
    "--state-file",
    "state.env",
    "--env-file",
    "override.env",
    "--compose-file",
    "search.yml",
  ]);
  assert.deepEqual(composeArgs(options, "config", "--quiet"), [
    "compose",
    "--env-file",
    "runtime.env",
    "--env-file",
    "override.env",
    "--env-file",
    "state.env",
    "-f",
    "release.yml",
    "-f",
    "search.yml",
    "config",
    "--quiet",
  ]);
  assert.throws(
    () => parseArguments(["create", "--env-file", "--yes"]),
    /requires a value/u,
  );
  assert.throws(
    () => parseArguments(["create", "--state-file", "a", "--state-file", "b"]),
    /only once/u,
  );
});

test("keeps runtime secret ownership separate from validated state", () => {
  const root = mkdtempSync(join(tmpdir(), "docmost-input-test-"));
  try {
    const runtime = join(root, "runtime.env");
    const override = join(root, "override.env");
    const state = join(root, "state.env");
    const compose = join(root, "compose.yml");
    writeFileSync(compose, "services: {}\n");
    writeFileSync(runtime, "APP_SECRET=synthetic-only\nPOSTGRES_USER=first\n");
    writeFileSync(override, "POSTGRES_USER=second\n");
    writeFileSync(
      state,
      "POSTGRES_VOLUME_NAME=test_db\nDOCMOST_STORAGE_VOLUME_NAME=test_storage\nMIGRATION_PHASE=accepted\n",
    );
    const args = [
      "create",
      "--env-file",
      runtime,
      "--env-file",
      override,
      "--state-file",
      state,
      "--compose-file",
      compose,
    ];
    const context = createContext(parseArguments(args));
    assert.equal(context.legacyEnvFile, runtime);
    assert.equal(
      context.environment.POSTGRES_USER,
      process.env.POSTGRES_USER || "second",
    );
    assert.equal(readFileSync(state, "utf8").includes("APP_SECRET"), false);
    if (process.env.APP_SECRET === undefined) {
      const stateBefore = readFileSync(state, "utf8");
      const overrideBefore = readFileSync(override, "utf8");
      context.environment.POSTGRES_DB = "compose-rendered-database";
      importLegacySecret(
        context,
        "synthetic-restored-secret-at-least-32-characters",
      );
      assert.equal(
        context.environment.POSTGRES_DB,
        "compose-rendered-database",
      );
      assert.match(
        readFileSync(runtime, "utf8"),
        /APP_SECRET=synthetic-restored-secret/u,
      );
      assert.equal(readFileSync(state, "utf8"), stateBefore);
      assert.equal(readFileSync(override, "utf8"), overrideBefore);
      writeFileSync(
        override,
        "APP_SECRET=synthetic-shadowed-secret-at-least-32-characters\n",
      );
      const shadowed = createContext(parseArguments(args));
      assert.equal(shadowed.legacyEnvFile, override);
      importLegacySecret(
        shadowed,
        "synthetic-final-secret-at-least-32-characters",
      );
      assert.match(
        readFileSync(override, "utf8"),
        /APP_SECRET=synthetic-final-secret/u,
      );
      assert.equal(readFileSync(state, "utf8"), stateBefore);
    }
    writeFileSync(state, "APP_SECRET=never-a-state-field\n");
    assert.throws(() => createContext(parseArguments(args)), /unsupported/u);
    writeFileSync(
      state,
      "POSTGRES_VOLUME_NAME=test_db\nDOCMOST_STORAGE_VOLUME_NAME=test_storage\nMIGRATION_PHASE=acceptance\n",
    );
    assert.throws(
      () => createContext(parseArguments(args)),
      /ready\/accepted/u,
    );
    assert.throws(
      () =>
        createContext(
          parseArguments([
            "create",
            "--compose-file",
            compose,
            "--env-file",
            state,
            "--state-file",
            state,
          ]),
        ),
      /separate/u,
    );
    assert.throws(
      () =>
        createContext(
          parseArguments([
            "create",
            "--compose-file",
            compose,
            "--env-file",
            join(root, "missing"),
          ]),
        ),
      /missing/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allocates distinct bounded candidate names without reusing sources", () => {
  const sources = {
    database: "d".repeat(127),
    storage: "storage",
    redis: "redis",
  };
  const candidates = candidateVolumeNames(sources, "a".repeat(32));
  assert.equal(new Set(Object.values(candidates)).size, 3);
  for (const [role, name] of Object.entries(candidates)) {
    assert.notEqual(name, sources[role]);
    assert.ok(name.length <= 127);
  }
});

test("accepts pnpm's explicit argument separator", () => {
  assert.deepEqual(
    parseArguments(["--", "verify", "--archive", "C:\\backup.tar", "--json"]),
    {
      command: "verify",
      composeFile: "docker-compose.yml",
      envFile: ".env",
      composeFiles: ["docker-compose.yml"],
      envFiles: [".env"],
      stateFile: undefined,
      maintenanceConfirmed: false,
      archive: "C:\\backup.tar",
      snapshotArchive: undefined,
      noSnapshot: false,
      allowLegacyEnv: false,
      noStart: false,
      replace: false,
      yes: false,
      json: true,
    },
  );
});

test("analyzes restored PostgreSQL statistics in stages", () => {
  assert.deepEqual(
    postRestoreAnalyzeArgs(
      { envFile: "runtime.env", composeFile: "compose.yml" },
      "docmost",
      "docmost",
    ),
    [
      "compose",
      "--env-file",
      "runtime.env",
      "-f",
      "compose.yml",
      "exec",
      "-T",
      "db",
      "vacuumdb",
      "--analyze-in-stages",
      "-U",
      "docmost",
      "-d",
      "docmost",
    ],
  );
});

test("detects current and legacy exact outer member sets", () => {
  const regular = (path) => ({ path: `./${path}`, type: "-" });
  assert.equal(
    detectBackupFormat(
      ["manifest.json", "postgres.dump", "storage.tar.gz"].map(regular),
    ),
    "v1",
  );
  assert.equal(
    detectBackupFormat(
      [".env", "docker-compose.yml", "postgres.dump", "storage.tar"].map(
        regular,
      ),
    ),
    "legacy",
  );
  assert.throws(
    () => detectBackupFormat([regular("postgres.dump"), regular(".env")]),
    /supported format/u,
  );
});

test("rejects unsafe storage paths and non-regular types", () => {
  assert.throws(
    () => assertSafeTarEntries([{ path: "../escape", type: "-" }]),
    /unsafe path/u,
  );
  assert.throws(
    () => assertSafeTarEntries([{ path: "/absolute", type: "-" }]),
    /absolute path/u,
  );
  assert.throws(
    () => assertSafeTarEntries([{ path: "safe", type: "l" }]),
    /type is not allowed/u,
  );
  assert.throws(
    () =>
      assertSafeTarEntries([
        { path: "same", type: "-" },
        { path: "./same", type: "-" },
      ]),
    /duplicate path/u,
  );
  assert.throws(
    () =>
      assertSafeTarEntries([{ path: "other/file", type: "-" }], {
        legacyStorage: true,
      }),
    /outside storage/u,
  );
});

test("pairs tar names with entry types", () => {
  assert.deepEqual(
    parseTarListings(
      "./one\n./two/\n",
      "-rw-r--r-- root/root 1 2026-01-01 00:00 ./one\ndrwxr-xr-x root/root 0 2026-01-01 00:00 ./two/\n",
    ),
    [
      { path: "./one", type: "-", bytes: 1 },
      { path: "./two/", type: "d", bytes: 0 },
    ],
  );
});

test("imports only an explicitly selected legacy APP_SECRET", () => {
  const secret = "12345678901234567890123456789012";
  assert.equal(
    readLegacyAppSecret(`SMTP_PASSWORD=do-not-import\nAPP_SECRET=${secret}\n`),
    secret,
  );
  assert.equal(
    replaceEnvValue(
      "MAIL_DRIVER=log\nAPP_SECRET=old-old-old-old-old-old-old-old\n",
      "APP_SECRET",
      secret,
    ),
    `MAIL_DRIVER=log\nAPP_SECRET=${secret}\n`,
  );
  assert.throws(
    () => readLegacyAppSecret("APP_SECRET=short\n"),
    /unsupported/u,
  );
});

test("validates the secret-free manifest contract", () => {
  const descriptor = { bytes: 1, sha256: "a".repeat(64) };
  assert.equal(
    validateManifest({
      schema: BACKUP_SCHEMA,
      secrets: { included: false },
      redis: { included: false },
      payloads: {
        "postgres.dump": descriptor,
        "storage.tar.gz": descriptor,
      },
    }).schema,
    BACKUP_SCHEMA,
  );
  assert.throws(
    () =>
      validateManifest({
        schema: BACKUP_SCHEMA,
        secrets: { included: true },
        redis: { included: false },
        payloads: {},
      }),
    /secrets are excluded/u,
  );
});

test("builds a deterministic storage inventory", () => {
  const expected = {
    fileCount: 2,
    totalBytes: 3,
    pathSetSha256:
      "f845278be4e8e54ba5067a24f35d379fd4af0dffa1da6b15052dca153ddf91e1",
  };
  assert.deepEqual(
    storageInventoryFromNullDelimited(
      Buffer.from("b.txt\u00002\u0000a.txt\u00001\u0000", "utf8"),
    ),
    expected,
  );
  assert.deepEqual(
    storageInventoryFromTarEntries([
      { path: "./b.txt", type: "-", bytes: 2 },
      { path: "./folder/", type: "d", bytes: 0 },
      { path: "./a.txt", type: "-", bytes: 1 },
    ]),
    expected,
  );
});
