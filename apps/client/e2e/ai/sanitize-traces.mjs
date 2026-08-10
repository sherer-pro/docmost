import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";

const auditRoot = path.resolve(process.env.DOCMOST_AI_AUDIT_ROOT ?? process.argv[2] ?? ".");
const tracesDir = path.join(auditRoot, "traces");
const exactSecrets = [
  process.env.DOCMOST_AUDIT_CANARY,
  process.env.DOCMOST_AUTH_TOKEN,
  process.env.DOCMOST_CSRF_TOKEN,
  ...(process.env.DOCMOST_AUDIT_EXTRA_SECRETS ?? "").split(","),
].filter((value) => typeof value === "string" && value.length > 0);

function sanitizeText(value) {
  let next = value;
  let replacements = 0;
  const replace = (pattern, replacement) => {
    next = next.replace(pattern, (...args) => {
      replacements += 1;
      return typeof replacement === "function" ? replacement(...args) : replacement;
    });
  };
  for (const secret of exactSecrets) replaceAll(secret, "[redacted-secret]");
  replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-jwt]");
  replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, "Bearer [redacted]");
  replace(/((?:authToken|csrfToken)(?:=|%3D|\"\s*:\s*\"))[A-Za-z0-9._%-]{20,}/gi, (_match, prefix) => `${prefix}[redacted]`);
  return { text: next, replacements };

  function replaceAll(search, replacement) {
    if (!search || !next.includes(search)) return;
    const parts = next.split(search);
    replacements += parts.length - 1;
    next = parts.join(replacement);
  }
}

const report = { sanitizedAt: new Date().toISOString(), archives: 0, entries: 0, replacements: 0 };
const files = await fs.readdir(tracesDir).catch(() => []);
for (const name of files.filter((file) => file.endsWith(".zip"))) {
  const target = path.join(tracesDir, name);
  const archive = unzipSync(new Uint8Array(await fs.readFile(target)));
  for (const [entry, bytes] of Object.entries(archive)) {
    if (!/(?:\.trace|\.network|\.json|\.txt|\.html|stacks)$/i.test(entry)) continue;
    const result = sanitizeText(Buffer.from(bytes).toString("utf8"));
    if (result.replacements > 0) {
      archive[entry] = new TextEncoder().encode(result.text);
      report.entries += 1;
      report.replacements += result.replacements;
    }
  }
  await fs.writeFile(target, Buffer.from(zipSync(archive, { level: 6 })));
  report.archives += 1;
}
await fs.writeFile(path.join(auditRoot, "trace-sanitization.json"), `${JSON.stringify(report, null, 2)}\n`);
