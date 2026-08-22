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
import { parseArguments, postRestoreAnalyzeArgs } from "./backup.mjs";

test("accepts pnpm's explicit argument separator", () => {
  assert.deepEqual(
    parseArguments(["--", "verify", "--archive", "C:\\backup.tar", "--json"]),
    {
      command: "verify",
      composeFile: "docker-compose.yml",
      envFile: ".env",
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
