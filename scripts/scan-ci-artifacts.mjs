import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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

export async function scanArtifacts(root, exactSecrets = []) {
  const findings = [];
  for (const path of await filesUnder(root)) {
    const content = await readFile(path, "utf8");
    for (const secret of exactSecrets.filter(Boolean)) {
      if (content.includes(secret)) {
        findings.push(`${path}: exact secret`);
      }
    }
    for (const pattern of sensitivePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        findings.push(`${path}: credential pattern`);
      }
    }
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
