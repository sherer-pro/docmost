import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";

const TEXT_FILE_PATTERN = /\.(?:html?|json|log|network|trace|txt)$/i;
const ZIP_TEXT_ENTRY_PATTERN =
  /(?:\.(?:html?|json|log|network|trace|txt)|stacks)$/i;

function createSanitizer(exactSecrets) {
  return (value) => {
    let text = value;
    let replacements = 0;
    const replace = (pattern, replacement) => {
      text = text.replace(pattern, (...args) => {
        replacements += 1;
        return typeof replacement === "function"
          ? replacement(...args)
          : replacement;
      });
    };

    for (const secret of exactSecrets) {
      if (!secret || !text.includes(secret)) continue;
      const parts = text.split(secret);
      replacements += parts.length - 1;
      text = parts.join("[redacted-secret]");
    }
    replace(
      /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
      "[redacted-jwt]",
    );
    replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, "Bearer [redacted]");
    replace(
      /((?:authToken|csrfToken|x-csrf-token)(?:=|%3D|\"\s*:\s*\"))[A-Za-z0-9._%-]{20,}/gi,
      (_match, prefix) => `${prefix}[redacted]`,
    );
    replace(
      /((?:password)(?:\\?\"|\"|')?\s*[:=]\s*(?:\\?\"|\"|')?)(?!\[redacted\])[^\"'\\\s,}]+/gi,
      (_match, prefix) => `${prefix}[redacted]`,
    );
    replace(
      /(\"type\":\"(?:send|receive)\"[^\r\n]*?\"data\":\")(?!\[redacted-websocket-frame\])(?:\\.|[^\"\\])*(\")/g,
      (_match, prefix, suffix) =>
        `${prefix}[redacted-websocket-frame]${suffix}`,
    );

    return { text, replacements };
  };
}

async function walk(directory) {
  const output = [];
  for (const entry of await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => [])) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(target)));
    else output.push(target);
  }
  return output;
}

export async function sanitizeAuditArtifacts(auditRoot) {
  const exactSecrets = [
    process.env.DOCMOST_AUTH_TOKEN,
    process.env.DOCMOST_CSRF_TOKEN,
  ].filter((value) => typeof value === "string" && value.length > 0);
  const sanitize = createSanitizer(exactSecrets);
  const report = {
    sanitizedAt: new Date().toISOString(),
    textFiles: 0,
    traceArchives: 0,
    entries: 0,
    replacements: 0,
    credentialFindings: 0,
  };

  for (const file of await walk(auditRoot)) {
    const relative = path.relative(auditRoot, file);
    const isTraceArchive =
      file.endsWith(".zip") &&
      (relative.includes("playwright-artifacts") ||
        relative.includes("playwright-html"));
    if (isTraceArchive) {
      const archive = unzipSync(new Uint8Array(await fs.readFile(file)));
      for (const [entry, bytes] of Object.entries(archive)) {
        if (!ZIP_TEXT_ENTRY_PATTERN.test(entry)) continue;
        const result = sanitize(Buffer.from(bytes).toString("utf8"));
        if (result.replacements > 0) {
          archive[entry] = new TextEncoder().encode(result.text);
          report.entries += 1;
          report.replacements += result.replacements;
        }
        const verification = sanitize(result.text);
        report.credentialFindings += verification.replacements;
      }
      await fs.writeFile(file, Buffer.from(zipSync(archive, { level: 6 })));
      report.traceArchives += 1;
      continue;
    }

    if (!TEXT_FILE_PATTERN.test(file)) continue;
    const original = await fs.readFile(file, "utf8");
    const result = sanitize(original);
    if (result.replacements > 0) {
      await fs.writeFile(file, result.text, "utf8");
      report.replacements += result.replacements;
    }
    report.credentialFindings += sanitize(result.text).replacements;
    report.textFiles += 1;
  }

  await fs.writeFile(
    path.join(auditRoot, "artifact-sanitization.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}
