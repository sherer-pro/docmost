import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";

export const BACKUP_SCHEMA = "docmost-backup/v1";
export const NEW_BACKUP_MEMBERS = [
  "manifest.json",
  "postgres.dump",
  "storage.tar.gz",
];
export const LEGACY_BACKUP_MEMBERS = [
  ".env",
  "docker-compose.yml",
  "postgres.dump",
  "storage.tar",
];

const SAFE_SECRET = /^[A-Za-z0-9._~+/=-]{32,}$/u;

export function normalizeTarPath(value) {
  let normalized = String(value).trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

export function assertSafeTarEntries(entries, options = {}) {
  const { legacyStorage = false, outer = false } = options;
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== "string") {
      throw new Error("Archive contains an unreadable entry");
    }
    if (/^[A-Za-z]:/u.test(entry.path) || entry.path.startsWith("/")) {
      throw new Error(`Archive contains an absolute path: ${entry.path}`);
    }
    if (
      entry.path.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(entry.path)
    ) {
      throw new Error(
        `Archive path contains unsupported characters: ${entry.path}`,
      );
    }
    const normalized = normalizeTarPath(entry.path);
    if (!normalized) {
      if (entry.type === "d") continue;
      throw new Error("Archive contains an empty path");
    }
    if (!outer && !["-", "d"].includes(entry.type)) {
      throw new Error(`Archive entry type is not allowed: ${entry.type}`);
    }
    if (outer && entry.type !== "-") {
      throw new Error(
        `Outer archive member must be a regular file: ${entry.path}`,
      );
    }
    const segments = normalized.split("/");
    if (
      segments.some(
        (segment) => !segment || segment === "." || segment === "..",
      )
    ) {
      throw new Error(`Archive contains an unsafe path: ${entry.path}`);
    }
    if (legacyStorage && segments[0] !== "storage") {
      throw new Error(
        `Legacy storage member is outside storage/: ${entry.path}`,
      );
    }
    if (seen.has(normalized)) {
      throw new Error(`Archive contains a duplicate path: ${normalized}`);
    }
    seen.add(normalized);
  }
  return [...seen];
}

export function detectBackupFormat(entries) {
  const names = assertSafeTarEntries(entries, { outer: true }).sort();
  const current = [...NEW_BACKUP_MEMBERS].sort();
  const legacy = [...LEGACY_BACKUP_MEMBERS].sort();
  if (JSON.stringify(names) === JSON.stringify(current)) return "v1";
  if (JSON.stringify(names) === JSON.stringify(legacy)) return "legacy";
  throw new Error(
    `Outer archive members do not match a supported format: ${names.join(", ")}`,
  );
}

export function parseTarListings(namesOutput, verboseOutput) {
  const names = namesOutput.split(/\r?\n/u).filter(Boolean);
  const verbose = verboseOutput.split(/\r?\n/u).filter(Boolean);
  if (names.length !== verbose.length) {
    throw new Error("Archive listing is inconsistent");
  }
  return names.map((path, index) => ({
    path,
    type: verbose[index][0],
    bytes: Number(/^\S+\s+\S+\s+(\d+)\s/u.exec(verbose[index])?.[1]),
  }));
}

export function parseEnvFile(source) {
  const values = {};
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/u.exec(trimmed);
    if (!match)
      throw new Error("Environment file contains an unsupported line");
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

export function readLegacyAppSecret(source) {
  const secret = parseEnvFile(source).APP_SECRET;
  if (!secret || !SAFE_SECRET.test(secret)) {
    throw new Error("Legacy archive APP_SECRET is missing or unsupported");
  }
  return secret;
}

export function replaceEnvValue(source, key, value) {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
    throw new Error("Environment key is invalid");
  }
  if (key === "APP_SECRET" && !SAFE_SECRET.test(value)) {
    throw new Error("APP_SECRET must be at least 32 safe characters");
  }
  const lines = source.split(/\r?\n/u);
  let replaced = false;
  const output = lines.map((line) => {
    if (new RegExp(`^(?:export\\s+)?${key}=`, "u").test(line.trim())) {
      if (replaced) throw new Error(`${key} is declared more than once`);
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) output.push(`${key}=${value}`);
  return output.join("\n").replace(/\n*$/u, "\n");
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function payloadDescriptor(path) {
  return {
    bytes: statSync(path).size,
    sha256: await sha256File(path),
  };
}

export function validateManifest(manifest) {
  if (!manifest || manifest.schema !== BACKUP_SCHEMA) {
    throw new Error("Backup manifest schema is not supported");
  }
  if (manifest.secrets?.included !== false) {
    throw new Error("Backup manifest must declare that secrets are excluded");
  }
  if (manifest.redis?.included !== false) {
    throw new Error("Backup manifest must declare that Redis is excluded");
  }
  for (const member of ["postgres.dump", "storage.tar.gz"]) {
    const descriptor = manifest.payloads?.[member];
    if (
      !descriptor ||
      !Number.isSafeInteger(descriptor.bytes) ||
      descriptor.bytes < 0 ||
      !/^[0-9a-f]{64}$/u.test(descriptor.sha256 || "")
    ) {
      throw new Error(`Backup manifest payload is invalid: ${member}`);
    }
  }
  return manifest;
}

export function storageInventoryFromNullDelimited(buffer) {
  const fields = buffer.toString("utf8").split("\u0000");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 2 !== 0) {
    throw new Error("Storage inventory output is malformed");
  }
  const records = [];
  for (let index = 0; index < fields.length; index += 2) {
    const path = fields[index];
    const bytes = Number(fields[index + 1]);
    assertSafeTarEntries([{ path, type: "-" }]);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`Storage size is invalid: ${path}`);
    }
    records.push({ path, bytes });
  }
  records.sort((left, right) => left.path.localeCompare(right.path));
  const digest = createHash("sha256");
  let totalBytes = 0;
  for (const record of records) {
    digest.update(`${record.path}\u0000${record.bytes}\u0000`);
    totalBytes += record.bytes;
  }
  return {
    fileCount: records.length,
    totalBytes,
    pathSetSha256: digest.digest("hex"),
  };
}

export function storageInventoryFromTarEntries(entries) {
  const records = entries
    .filter((entry) => entry.type === "-")
    .map((entry) => {
      const path = normalizeTarPath(entry.path);
      if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
        throw new Error(`Storage size is invalid: ${path}`);
      }
      return { path, bytes: entry.bytes };
    });
  const fields = [];
  for (const record of records) fields.push(record.path, String(record.bytes));
  return storageInventoryFromNullDelimited(
    Buffer.from(
      fields.length > 0 ? `${fields.join("\u0000")}\u0000` : "",
      "utf8",
    ),
  );
}
