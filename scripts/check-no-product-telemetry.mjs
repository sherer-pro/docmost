import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const FORBIDDEN_PATTERNS = [
  ["PostHog dependency", /\bposthog-js\b/iu],
  ["PostHog runtime symbol", /\bPostHog(?:Provider|User)?\b/iu],
  ["Docmost telemetry endpoint", /tel\.docmost\.com/iu],
  ["retired telemetry switch", /\bDISABLE_TELEMETRY\b/u],
  ["retired PostHog host", /\bPOSTHOG_HOST\b/u],
  ["retired PostHog key", /\bPOSTHOG_KEY\b/u],
  ["removed telemetry module", /\bTelemetryModule\b/u],
];

const SOURCE_ROOTS = ["apps/client/src", "apps/server/src"];
const CONTRACT_FILES = [
  "apps/client/package.json",
  "apps/client/vite.config.ts",
  ".env.example",
  ".env.compose.example",
  ".env.production.example",
  "docker-compose.yml",
  "compose.production.yml",
  ".github/workflows/ci.yml",
  "tests/rag-sync/compose.yml",
  "apps/client/e2e/ai-agent/docker-compose.audit.yml",
  "scripts/ci-postgres-runtime-migration-smoke.mjs",
];

function collectFiles(directory) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? collectFiles(path) : [path];
  });
}

export function validateNoProductTelemetry(sources) {
  const issues = [];

  for (const [path, source] of Object.entries(sources)) {
    for (const [label, pattern] of FORBIDDEN_PATTERNS) {
      if (pattern.test(source)) {
        issues.push(`${path}: ${label}`);
      }
    }
  }

  return issues;
}

function loadProductionSources() {
  const files = [
    ...SOURCE_ROOTS.flatMap((directory) => collectFiles(join(root, directory))),
    ...CONTRACT_FILES.map((path) => join(root, path)).filter(existsSync),
  ];

  return Object.fromEntries(
    files.map((path) => [path.slice(root.length + 1), readFileSync(path, "utf8")]),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issues = validateNoProductTelemetry(loadProductionSources());

  if (issues.length > 0) {
    console.error("Product telemetry removal contract violations:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }

  console.log("Product telemetry removal contract is intact.");
}
