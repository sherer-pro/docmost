import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(
  await readFile(new URL('package.json', root), 'utf8'),
);
const journal = JSON.parse(
  await readFile(
    new URL('docs/security-dependency-exceptions.json', root),
    'utf8',
  ),
);

const ignored = new Set(packageJson.pnpm?.auditConfig?.ignoreGhsas ?? []);
const exceptions = new Map(
  (journal.exceptions ?? []).map((entry) => [entry.ghsa, entry]),
);
const errors = [];
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

for (const ghsa of ignored) {
  const entry = exceptions.get(ghsa);
  if (!entry) {
    errors.push(`${ghsa}: missing exception journal entry`);
    continue;
  }
  if (!entry.package || !entry.status || !entry.evidence) {
    errors.push(`${ghsa}: package, status, and evidence are required`);
  }
  const reviewAfter = new Date(`${entry.reviewAfter}T00:00:00.000Z`);
  if (!entry.reviewAfter || Number.isNaN(reviewAfter.getTime())) {
    errors.push(`${ghsa}: reviewAfter must be an ISO date`);
  } else if (reviewAfter < today) {
    errors.push(`${ghsa}: exception review expired on ${entry.reviewAfter}`);
  }
}

for (const ghsa of exceptions.keys()) {
  if (!ignored.has(ghsa)) {
    errors.push(`${ghsa}: journal entry is not present in pnpm auditConfig`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${ignored.size} dependency audit exceptions`);
}
