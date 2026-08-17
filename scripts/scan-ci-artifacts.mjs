import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

// Playwright videos and traces are far larger than one JavaScript string can
// hold, so artifacts are scanned in chunks. The carry-over keeps a match that
// straddles a chunk boundary visible.
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_PATTERN_SPAN = 4096;

const sensitivePatterns = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  /\bBearer\s+(?!\[REDACTED\])[^\s"']+/giu,
  /\b(?:authToken|csrfToken|sessionToken)=(?!\[REDACTED\])[^;\s]+/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu,
  /\b(?:postgres(?:ql)?|redis):\/\/[^\s/@:]+:[^\s/@]+@/giu,
];

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function scanFile(path, exactSecrets) {
  const findings = [];
  const reportedSecrets = new Set();
  const reportedPatterns = new Set();
  const carryLength = Math.max(
    MAX_PATTERN_SPAN,
    ...exactSecrets.map((secret) => secret.length),
  );
  let carry = "";

  for await (const chunk of createReadStream(path, {
    encoding: "utf8",
    highWaterMark: CHUNK_BYTES,
  })) {
    const window = carry + chunk;
    for (const secret of exactSecrets) {
      if (!reportedSecrets.has(secret) && window.includes(secret)) {
        reportedSecrets.add(secret);
        findings.push(`${path}: exact secret`);
      }
    }
    for (const pattern of sensitivePatterns) {
      if (reportedPatterns.has(pattern)) continue;
      pattern.lastIndex = 0;
      if (pattern.test(window)) {
        reportedPatterns.add(pattern);
        findings.push(`${path}: credential pattern`);
      }
    }
    carry = window.slice(-carryLength);
  }

  return findings;
}

export async function scanArtifacts(root, exactSecrets = []) {
  const findings = [];
  const secrets = exactSecrets.filter(Boolean);
  for (const path of await filesUnder(root)) {
    findings.push(...(await scanFile(path, secrets)));
  }
  return findings;
}

if (process.argv[1]?.endsWith("scan-ci-artifacts.mjs")) {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: node scripts/scan-ci-artifacts.mjs <directory>");
    process.exitCode = 2;
  } else {
    const secrets = (process.env.CI_LOG_CANARIES ?? "").split(";");
    const findings = await scanArtifacts(root, secrets);
    if (findings.length > 0) {
      console.error(
        `Sensitive CI artifact content detected (${findings.length} finding(s)).`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        "CI artifacts passed exact-secret and credential-pattern scan.",
      );
    }
  }
}
