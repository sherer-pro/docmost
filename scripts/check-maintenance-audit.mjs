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
      rationaleByCategory: {
        duplicates:
          "Compatibility aliases expose both named and default exports.",
        enumMembers:
          "Reserved protocol and domain states remain part of stable enums.",
        exports:
          "Public, test, framework, and reflection entry points are reviewed before removal.",
        types:
          "Generated database and reusable contract types intentionally exceed direct imports.",
      },
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
