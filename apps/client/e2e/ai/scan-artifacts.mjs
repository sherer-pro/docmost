import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

const root = path.resolve(process.argv[2] ?? process.env.DOCMOST_AI_AUDIT_ROOT ?? ".");
const secrets = [
  process.env.DOCMOST_AUDIT_CANARY,
  process.env.DOCMOST_AUTH_TOKEN,
  process.env.DOCMOST_CSRF_TOKEN,
  ...(process.env.DOCMOST_AUDIT_EXTRA_SECRETS ?? "").split(","),
].filter((value) => typeof value === "string" && value.length > 0);

async function filesBelow(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

function hit(buffer, secret) {
  return buffer.includes(Buffer.from(secret, "utf8"));
}

function credentialPatterns(buffer) {
  const text = buffer.toString("utf8");
  const patterns = [
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    /(?:authToken|csrfToken)(?:=|%3D|\"\s*:\s*\")[A-Za-z0-9._%-]{20,}/gi,
    /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
  ];
  return patterns.flatMap((pattern) => text.match(pattern) ?? []);
}

const findings = [];
for (const file of await filesBelow(root)) {
  const buffer = await fs.readFile(file);
  for (const secret of secrets) {
    if (hit(buffer, secret)) findings.push({ file: path.relative(root, file), secretHash: createHash("sha256").update(secret).digest("hex").slice(0, 16) });
  }
  for (const value of credentialPatterns(buffer)) findings.push({ file: path.relative(root, file), credentialPattern: value.slice(0, 16) });
  if (path.extname(file).toLowerCase() === ".zip") {
    const archive = unzipSync(new Uint8Array(buffer));
    for (const [entry, bytes] of Object.entries(archive)) {
      const entryBuffer = Buffer.from(bytes);
      for (const secret of secrets) {
        if (hit(entryBuffer, secret)) findings.push({ file: `${path.relative(root, file)}!${entry}`, secretHash: createHash("sha256").update(secret).digest("hex").slice(0, 16) });
      }
      for (const value of credentialPatterns(entryBuffer)) findings.push({ file: `${path.relative(root, file)}!${entry}`, credentialPattern: value.slice(0, 16) });
    }
  }
}

const report = {
  scannedAt: new Date().toISOString(),
  root,
  secretCount: secrets.length,
  clean: findings.length === 0,
  findings,
};
await fs.writeFile(path.join(root, "secret-scan.json"), `${JSON.stringify(report, null, 2)}\n`);
if (findings.length) {
  throw new Error(`Secret scanner found ${findings.length} occurrence(s); see secret-scan.json`);
}
