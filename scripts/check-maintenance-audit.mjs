import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const baselinePath = join(root, "docs", "maintenance-audit-baseline.json");
const trackedKnipCategories = [
  "binaries",
  "catalog",
  "dependencies",
  "devDependencies",
  "duplicates",
  "enumMembers",
  "exports",
  "files",
  "namespaceMembers",
  "optionalPeerDependencies",
  "types",
  "unlisted",
  "unresolved",
];

export function normalizeKnipIssues(report) {
  const fingerprints = [];
  for (const issue of report.issues ?? []) {
    for (const category of trackedKnipCategories) {
      for (const finding of issue[category] ?? []) {
        const descriptor = Array.isArray(finding)
          ? finding
              .map((item) => `${item.namespace ?? ""}:${item.name ?? ""}`)
              .sort()
              .join("+")
          : (finding.name ?? stableJsonWithoutLocations(finding));
        fingerprints.push(
          `${category}|${normalizePath(issue.file)}|${descriptor}`,
        );
      }
    }
  }
  return [...new Set(fingerprints)].sort();
}

export function normalizeJscpdDuplicates(report) {
  return (report.duplicates ?? [])
    .map((duplicate) => {
      const files = [
        normalizePath(duplicate.firstFile.name),
        normalizePath(duplicate.secondFile.name),
      ].sort();
      return `${duplicate.format}|${files.join("|")}|${duplicate.lines}|${duplicate.tokens}`;
    })
    .sort();
}

export function compareFingerprints(current, accepted) {
  const currentSet = new Set(current);
  const acceptedSet = new Set(accepted);
  return {
    added: current.filter((item) => !acceptedSet.has(item)),
    resolved: accepted.filter((item) => !currentSet.has(item)),
  };
}

export function validateKnipReviewGroups(
  accepted,
  reviewGroups,
  now = new Date(),
) {
  if (!Array.isArray(reviewGroups) || reviewGroups.length === 0) {
    throw new Error("Knip baseline reviewGroups must be a non-empty array.");
  }
  const ids = new Set();
  const compiledGroups = reviewGroups.map((group) => {
    for (const field of [
      "id",
      "owner",
      "classification",
      "rationale",
      "pathPattern",
      "reviewBy",
    ]) {
      if (typeof group?.[field] !== "string" || !group[field].trim()) {
        throw new Error(`Knip review group is missing a non-empty ${field}.`);
      }
    }
    if (ids.has(group.id)) {
      throw new Error(`Duplicate Knip review group id: ${group.id}`);
    }
    ids.add(group.id);
    const reviewBy = new Date(`${group.reviewBy}T23:59:59Z`);
    if (!Number.isFinite(reviewBy.getTime()) || reviewBy < now) {
      throw new Error(
        `Knip review group ${group.id} is overdue: ${group.reviewBy}`,
      );
    }
    let pathPattern;
    try {
      pathPattern = new RegExp(group.pathPattern, "u");
    } catch (error) {
      throw new Error(
        `Knip review group ${group.id} has an invalid pathPattern: ${error.message}`,
      );
    }
    return { ...group, pathPattern };
  });

  const matchedGroupIds = new Set();
  for (const fingerprint of accepted) {
    const path = fingerprint.split("|")[1] ?? "";
    const matches = compiledGroups.filter((group) =>
      group.pathPattern.test(path),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Knip finding must match exactly one review group (${matches.length} matched): ${fingerprint}`,
      );
    }
    matchedGroupIds.add(matches[0].id);
  }
  for (const group of compiledGroups) {
    if (!matchedGroupIds.has(group.id)) {
      throw new Error(
        `Knip review group has no accepted findings: ${group.id}`,
      );
    }
  }
}

function defaultKnipReviewGroups() {
  return [
    {
      id: "client-application-contracts",
      owner: "apps/client",
      classification: "reusable-or-compatibility-contract",
      rationale:
        "Private client exports are reviewed against cross-feature imports, tests, and compatibility aliases before removal.",
      pathPattern: "^apps/client/",
      reviewBy: "2026-11-14",
    },
    {
      id: "server-generated-database-types",
      owner: "apps/server/src/database/types",
      classification: "generated-contract-surface",
      rationale:
        "Generated Kysely entity aliases mirror the database schema and are reviewed after migration type regeneration.",
      pathPattern: "^apps/server/src/database/types/",
      reviewBy: "2026-11-14",
    },
    {
      id: "server-framework-and-domain-contracts",
      owner: "apps/server",
      classification: "framework-or-reusable-contract",
      rationale:
        "Server findings are reviewed with Nest reflection, module wiring, protocol constants, and route contracts before removal.",
      pathPattern: "^apps/server/(?!src/database/types/)",
      reviewBy: "2026-11-14",
    },
    {
      id: "editor-package-contracts",
      owner: "packages/editor-ext",
      classification: "public-package-contract",
      rationale:
        "Editor extension findings are reviewed against the package entry point and downstream editor consumers before removal.",
      pathPattern: "^packages/editor-ext/",
      reviewBy: "2026-11-14",
    },
  ];
}

function stableJsonWithoutLocations(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (["line", "col", "pos"].includes(key)) continue;
    result[key] = value[key];
  }
  return JSON.stringify(result);
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}

function runNodeCli(relativeCliPath, args, allowedStatuses = [0]) {
  const cliPath = join(root, ...relativeCliPath.split("/"));
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || !allowedStatuses.includes(result.status)) {
    const detail = result.error?.message ?? result.stderr?.trim();
    throw new Error(
      `Maintenance audit command failed (${relativeCliPath}): ${detail || `exit ${result.status}`}`,
    );
  }
  return result.stdout.replace(/^\uFEFF/u, "");
}

function collectCurrentAudit() {
  const knip = JSON.parse(
    runNodeCli("node_modules/knip/bin/knip.js", [
      "--config",
      "knip.json",
      "--reporter",
      "json",
      "--no-config-hints",
      "--no-exit-code",
    ]),
  );
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "docmost-maintenance-audit-"),
  );
  try {
    runNodeCli(
      "node_modules/jscpd/run-jscpd.js",
      [
        "--config",
        ".jscpd.json",
        "--reporters",
        "json",
        "--output",
        temporaryDirectory,
        "--no-tips",
      ],
      [0, 1],
    );
    const jscpd = JSON.parse(
      readFileSync(join(temporaryDirectory, "jscpd-report.json"), "utf8"),
    );
    return {
      knip: normalizeKnipIssues(knip),
      jscpd: normalizeJscpdDuplicates(jscpd),
    };
  } finally {
    const relativeTemporaryPath = relative(tmpdir(), temporaryDirectory);
    if (
      relativeTemporaryPath.startsWith("docmost-maintenance-audit-") &&
      !relativeTemporaryPath.includes(`..${sep}`)
    ) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function classificationForDuplicate(fingerprint) {
  if (/mermaid-sanitizer|html-pdf-renderer/u.test(fingerprint)) {
    return "security-policy-parity";
  }
  if (/\.module\.css/u.test(fingerprint)) return "editor-node-variant";
  if (/ai-assistant-profile\.dto/u.test(fingerprint)) {
    return "validation-schema-pair";
  }
  if (/emails|notification/u.test(fingerprint)) return "delivery-variant";
  if (/lib\//u.test(fingerprint)) return "editor-extension-variant";
  return "parallel-product-flow";
}

function writeBaseline(audit) {
  const baseline = {
    schemaVersion: 1,
    reviewedAt: "2026-08-14",
    reviewBy: "2026-11-14",
    policy: {
      newFindings: "blocked",
      resolvedFindings: "require-baseline-update",
      knipScope:
        "Exact symbol fingerprints; source locations are intentionally excluded.",
      duplicateScope:
        "Exact format, normalized file pair, line count, and token count fingerprints.",
    },
    knip: {
      accepted: audit.knip,
      reviewGroups: defaultKnipReviewGroups(),
    },
    jscpd: {
      accepted: audit.jscpd.map((fingerprint) => ({
        fingerprint,
        classification: classificationForDuplicate(fingerprint),
        rationale:
          "Behavior-specific variants require characterization coverage before shared extraction.",
      })),
    },
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(
    `Maintenance audit baseline written: ${audit.knip.length} Knip findings, ${audit.jscpd.length} duplicate blocks.`,
  );
}

function checkBaseline(audit) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const reviewBy = new Date(`${baseline.reviewBy}T23:59:59Z`);
  if (!Number.isFinite(reviewBy.getTime()) || reviewBy < new Date()) {
    throw new Error(
      `Maintenance audit baseline review is overdue: ${baseline.reviewBy}`,
    );
  }
  validateKnipReviewGroups(baseline.knip.accepted, baseline.knip.reviewGroups);
  const knip = compareFingerprints(audit.knip, baseline.knip.accepted);
  const acceptedDuplicates = baseline.jscpd.accepted.map(
    (entry) => entry.fingerprint,
  );
  const jscpd = compareFingerprints(audit.jscpd, acceptedDuplicates);
  const changes = [
    ...knip.added.map((item) => `new Knip finding: ${item}`),
    ...knip.resolved.map((item) => `resolved Knip finding: ${item}`),
    ...jscpd.added.map((item) => `new duplicate: ${item}`),
    ...jscpd.resolved.map((item) => `resolved duplicate: ${item}`),
  ];
  if (changes.length > 0) {
    throw new Error(
      `Maintenance audit baseline drifted:\n${changes.slice(0, 50).join("\n")}${changes.length > 50 ? `\n... and ${changes.length - 50} more` : ""}`,
    );
  }
  console.log(
    `Maintenance audit baseline intact: ${audit.knip.length} Knip findings, ${audit.jscpd.length} duplicate blocks; review by ${baseline.reviewBy}.`,
  );
}

async function main() {
  const audit = collectCurrentAudit();
  if (process.argv.includes("--write-baseline")) writeBaseline(audit);
  else checkBaseline(audit);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
