#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const FORBIDDEN_PATHS = [
  "apps/client/src/ee",
  "apps/server/src/ee",
  "packages/ee",
];

const HISTORICAL_EE_MIGRATIONS = new Set([
  "apps/server/src/database/migrations/20250106T195516-billing.ts",
  "apps/server/src/database/migrations/20250222T114520-add_license_key_to_workspace.ts",
  "apps/server/src/database/migrations/20250623T215045-more-billing-columns.ts",
  "apps/server/src/database/migrations/20260730T180000-remove-ee-license-column.ts",
  "apps/server/src/database/migrations/20260730T190000-remove-ee-billing.ts",
]);

export const FORBIDDEN_PATTERNS = [
  { name: "@docmost/ee alias", regex: /@docmost\/ee/ },
  { name: "LicenseCheckService", regex: /\bLicenseCheckService\b/ },
  { name: "hasLicenseKey", regex: /\bhasLicenseKey\b/ },
  { name: "enterpriseModules", regex: /\benterpriseModules\b/ },
  {
    name: "EE or enterprise module specifier",
    regex:
      /\b(?:from\s+|import\s*\(|require\s*\()\s*['"](?:@docmost\/ee(?:\/[^'"]*)?|(?:\.{0,2}[/\\])*(?:ee|enterprise)(?:[/\\][^'"]*)?)['"]/,
  },
  {
    name: "retired license, billing, or trial runtime symbol",
    regex:
      /\b(?:EE_LICENSE_KEY|ENTERPRISE_LICENSE_KEY|DOCMOST_LICENSE_KEY|LICENSE_KEY|BILLING_API_KEY|BILLING_URL|TRIAL_DAYS)\b/,
  },
  {
    name: "retired license or billing API route",
    regex: /['"]\/(?:api\/)?(?:license|billing)(?:\/[^'"]*)?['"]/,
  },
  {
    name: "retired billing or trial runtime reference",
    regex: /\b(?:billing|trial)\b/i,
    allowHistoricalMigration: true,
  },
  {
    name: "retired license_key schema reference",
    regex: /\blicense_key\b/i,
    allowHistoricalMigration: true,
  },
  {
    name: "historical EE source path reference",
    regex: /apps[/\\](?:client|server)[/\\]src[/\\]ee\b|packages[/\\]ee\b/,
  },
];

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sh",
  ".ps1",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
]);

const SCANNED_BASENAMES = new Set([
  ".npmrc",
  "Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

const IGNORED_FILES = new Set([
  "scripts/check-no-ee.mjs",
  "scripts/check-no-ee.test.mjs",
]);

const IGNORED_PREFIXES = ["graphify-out/"];

function trackedFiles(repoRoot, ...args) {
  const output = execFileSync("git", ["ls-files", "-z", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter(Boolean);
}

function shouldScan(file) {
  const basename = path.posix.basename(file);
  return (
    SCANNED_EXTENSIONS.has(path.posix.extname(file)) ||
    SCANNED_BASENAMES.has(basename) ||
    basename.startsWith(".env") ||
    basename.startsWith("Dockerfile.")
  );
}

export function auditNoEe(repoRoot = defaultRepoRoot) {
  const failures = [];

  for (const forbiddenPath of FORBIDDEN_PATHS) {
    const files = trackedFiles(repoRoot, "--", forbiddenPath);
    if (files.length > 0) {
      failures.push(
        `Tracked enterprise path "${forbiddenPath}" still contains ${files.length} file(s).`,
      );
    }
  }

  const gitmodulesPath = path.join(repoRoot, ".gitmodules");
  if (existsSync(gitmodulesPath)) {
    const gitmodules = readFileSync(gitmodulesPath, "utf8");
    if (
      /(?:^|[/\\])ee(?:[/\\]|\b)|\bee\]|github\.com[/\\]docmost[/\\]ee\b/im.test(
        gitmodules,
      )
    ) {
      failures.push(".gitmodules still declares an enterprise submodule.");
    }
  }

  for (const file of trackedFiles(repoRoot)) {
    if (IGNORED_FILES.has(file)) continue;
    if (IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    if (!shouldScan(file)) continue;

    let content;
    try {
      content = readFileSync(path.join(repoRoot, file), "utf8");
    } catch {
      continue;
    }

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (
        pattern.allowHistoricalMigration &&
        HISTORICAL_EE_MIGRATIONS.has(file)
      ) {
        continue;
      }
      if (pattern.regex.test(content)) {
        failures.push(
          `${file}: forbidden enterprise reference (${pattern.name}).`,
        );
      }
    }
  }

  return failures;
}

export function runNoEeCheck(repoRoot = defaultRepoRoot) {
  const failures = auditNoEe(repoRoot);
  if (failures.length > 0) {
    console.error("Enterprise (EE) leftovers detected:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    return 1;
  }

  console.log(
    "No enterprise modules, packages, runtime hooks, routes, or configuration references found.",
  );
  return 0;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  process.exitCode = runNoEeCheck();
}
