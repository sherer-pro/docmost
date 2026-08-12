import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_JOB_COMMANDS = {
  validate: [
    "pnpm check:no-ee",
    "pnpm test:no-ee",
    "pnpm check:architecture",
    "pnpm check:release-gates",
    "pnpm build",
    "pnpm routes:inventory:check",
    "pnpm check:rag-docs",
    "pnpm check:ai-docs",
    "pnpm test:text-contracts",
    "pnpm check:env",
    "pnpm lint",
    "pnpm --filter ./apps/client test",
    "pnpm --filter ./apps/server test",
    "pnpm test:rag-sync:contract",
    "pnpm test:security",
    "pnpm check:comments:en",
    "pnpm check:audit-exceptions",
    "pnpm audit --prod --audit-level high",
  ],
  integration: [
    "pnpm server:build",
    "pnpm --filter ./apps/server migration:latest",
    "pnpm --filter ./apps/server test:e2e",
  ],
  "production-smoke": [
    "docker build --build-arg PNPM_OFFLINE=0 -t docmost:ci .",
    "node scripts/ci-postgres-runtime-migration-smoke.mjs --app-image docmost:ci",
    "apps/server/dist/apps/server/src/database/migrate-latest.js",
    "node scripts/ci-production-smoke.mjs",
    "pnpm test:editor:e2e",
    "pnpm test:ai:e2e",
    "pnpm test:ai-context:e2e",
    "node scripts/ci-embedded-rag-sync-smoke.mjs prepare",
    "scripts/ci-rag-sync-db-invariants.sql",
    "docker restart --timeout 5 docmost-app docmost-app-replica",
    "node scripts/ci-embedded-rag-sync-smoke.mjs resume",
    "node scripts/sanitize-ci-log-stream.mjs",
    "node scripts/scan-ci-artifacts.mjs ci-artifacts",
    "touch ci-artifacts/.sanitized",
  ],
};

const REQUIRED_JOB_METADATA = {
  "production-smoke": [
    "-e DRAWIO_URL=https://embed.diagrams.net",
    "DOCMOST_DRAWIO_AUDIT_URL: https://embed.diagrams.net",
    "if: failure() && hashFiles('ci-artifacts/.sanitized') != ''",
    "retention-days: 7",
  ],
};

const REQUIRED_WORKFLOW_JOBS = {
  "rag-open-webui-compat.yml": {
    jobName: "compatibility",
    commands: [
      "node scripts/run-rag-open-webui-compat.mjs",
      "node scripts/sanitize-ci-log-stream.mjs",
      "node scripts/scan-ci-artifacts.mjs output/audit",
      "touch output/audit/.sanitized",
    ],
    metadata: [
      "if: failure() && hashFiles('output/audit/.sanitized') != ''",
      "retention-days: 7",
    ],
  },
};

const REQUIRED_VERIFICATION_COMMANDS = {
  "verify:quick": [
    "run check:no-ee",
    "run test:no-ee",
    "run check:architecture",
    "run check:release-gates",
    "run check:env",
    "run check:ai-docs",
    "run lint",
    "run test",
    "run test:security",
  ],
  "verify:full": [
    "run check:no-ee",
    "run test:no-ee",
    "run check:architecture",
    "run check:release-gates",
    "run check:env",
    "run check:ai-docs",
    "run build",
    "run lint",
    "run test:all",
    "run test:security",
  ],
  "verify:release": [
    "run verify:full",
    "run routes:inventory:check",
    "run check:rag-docs",
    "run check:comments:en",
    "run check:audit-exceptions",
    "run test:text-contracts",
    "run test:editor-ext",
    "run test:rag-sync:contract",
    "run test:mcp:audit-client",
    "pnpm audit --prod --audit-level high",
    "run test:ai:e2e",
    "run test:ai-agent:e2e",
    "run test:editor:e2e",
    "run test:ai-context:e2e",
  ],
};

function jobBlock(source, jobName) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) {
    return "";
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function hasNeed(block, dependency) {
  return new RegExp(
    `^    needs:\\s*(?:${dependency}|\\[[^\\]]*\\b${dependency}\\b[^\\]]*\\])\\s*$`,
    "mu",
  ).test(block);
}

function executableWorkflowText(block) {
  return block
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function workflowStepBlocks(block) {
  const lines = block.split(/\r?\n/u);
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^ {6}-\s+/u.test(lines[index])) {
      starts.push(index);
    }
  }
  return starts.map((start, index) =>
    lines.slice(start, starts[index + 1] ?? lines.length).join("\n"),
  );
}

function runLines(step) {
  const lines = step.split(/\r?\n/u);
  const runIndex = lines.findIndex((line) => /^\s+run:\s*/u.test(line));
  if (runIndex < 0) {
    return [];
  }
  const match = /^(\s+)run:\s*(.*)$/u.exec(lines[runIndex]);
  const value = match?.[2]?.trim() ?? "";
  if (!/^\|[-+]?$/u.test(value) && !/^>[-+]?$/u.test(value)) {
    return value ? [value] : [];
  }

  const indentation = match?.[1]?.length ?? 0;
  const result = [];
  for (let index = runIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      result.push("");
      continue;
    }
    const currentIndentation = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (currentIndentation <= indentation) {
      break;
    }
    result.push(line.trimStart());
  }
  return result;
}

function stepIsDisabled(step) {
  return /^\s+if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/imu.test(step);
}

function executableCommandLines(step, command) {
  if (stepIsDisabled(step)) {
    return [];
  }
  return runLines(step).filter((line) => {
    const trimmed = line.trim();
    const commandIndex = trimmed.indexOf(command);
    if (commandIndex < 0 || trimmed.startsWith("#")) {
      return false;
    }
    const prefix = trimmed.slice(0, commandIndex).trim();
    return !/^(?:echo|printf)\b/u.test(prefix);
  });
}

function requireWorkflowCommand(errors, block, jobName, command) {
  const matches = workflowStepBlocks(block).flatMap((step) =>
    executableCommandLines(step, command),
  );
  if (matches.length === 0) {
    errors.push(`${jobName} must run ${command}`);
    return;
  }
  if (
    matches.every((line) => line.slice(line.indexOf(command)).includes("||"))
  ) {
    errors.push(`${jobName} must not mask failures from ${command}`);
  }
}

function requireJobCommands(errors, block, jobName) {
  if (!block) {
    errors.push(`ci.yml must define the ${jobName} job`);
    return;
  }
  for (const command of REQUIRED_JOB_COMMANDS[jobName]) {
    requireWorkflowCommand(errors, block, jobName, command);
  }
  const executableText = executableWorkflowText(block);
  for (const metadata of REQUIRED_JOB_METADATA[jobName] ?? []) {
    if (!executableText.includes(metadata)) {
      errors.push(`${jobName} must define ${metadata}`);
    }
  }
  if (/^\s+continue-on-error:\s*true\s*$/mu.test(block)) {
    errors.push(`${jobName} must not continue on error`);
  }
}

function validateVerificationScripts(errors, packageJson) {
  for (const [scriptName, commands] of Object.entries(
    REQUIRED_VERIFICATION_COMMANDS,
  )) {
    const script = packageJson?.scripts?.[scriptName];
    if (typeof script !== "string") {
      errors.push(`package.json must define ${scriptName}`);
      continue;
    }
    const segments = script.split(/\s+&&\s+/u).map((segment) => segment.trim());
    for (const command of commands) {
      const expected = command.startsWith("pnpm ")
        ? `corepack ${command}`
        : `corepack pnpm ${command}`;
      if (!segments.includes(expected)) {
        errors.push(`${scriptName} must include ${command}`);
      }
    }
  }
}

function validateWorkflowHygiene(errors, workflowSources) {
  for (const [fileName, source] of Object.entries(workflowSources)) {
    if (!/^permissions:\s*\r?\n\s{2}contents:\s*read\s*$/mu.test(source)) {
      errors.push(`${fileName} must default to contents: read permissions`);
    }
    if (!/^concurrency:\s*$/mu.test(source)) {
      errors.push(`${fileName} must define concurrency`);
    }
    if (!/^\s{2}cancel-in-progress:\s*.+$/mu.test(source)) {
      errors.push(`${fileName} must define cancel-in-progress`);
    }

    for (const match of source.matchAll(
      /^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu,
    )) {
      const reference = match[1];
      if (reference.startsWith("./")) {
        continue;
      }
      if (
        reference.startsWith("docker://") &&
        /@sha256:[0-9a-f]{64}$/u.test(reference)
      ) {
        continue;
      }
      if (!/@[0-9a-f]{40}$/u.test(reference)) {
        errors.push(
          `${fileName} action ${reference} must use an immutable 40-character commit SHA`,
        );
      }
    }

    const requiredJob = REQUIRED_WORKFLOW_JOBS[fileName];
    if (requiredJob) {
      const block = jobBlock(source, requiredJob.jobName);
      for (const command of requiredJob.commands) {
        requireWorkflowCommand(errors, block, requiredJob.jobName, command);
      }
      const executableText = executableWorkflowText(block);
      for (const metadata of requiredJob.metadata) {
        if (!executableText.includes(metadata)) {
          errors.push(`${requiredJob.jobName} must define ${metadata}`);
        }
      }
    }
  }
}

function validateAiGuideGateMetadata(errors, ciSource) {
  const validate = jobBlock(ciSource, "validate");
  const steps = workflowStepBlocks(validate);
  const checkout = steps.find((step) => /actions\/checkout@/u.test(step));
  if (!checkout || !/^\s+fetch-depth:\s*0\s*$/mu.test(checkout)) {
    errors.push(
      "validate checkout must use fetch-depth: 0 for AI guide diff checks",
    );
  }

  const guideStep = steps.find(
    (step) => executableCommandLines(step, "pnpm check:ai-docs").length > 0,
  );
  for (const variable of ["AI_GUIDE_BASE_SHA", "AI_GUIDE_HEAD_SHA"]) {
    if (!guideStep || !new RegExp(`^\\s+${variable}:`, "mu").test(guideStep)) {
      errors.push(`AI documentation gate must receive ${variable}`);
    }
  }
}

export function validateReleaseGateContract({
  ciSource,
  dockerSource,
  workflowSources = {},
  packageJson,
}) {
  const errors = [];
  const integration = jobBlock(ciSource, "integration");
  const productionSmoke = jobBlock(ciSource, "production-smoke");
  const gates = jobBlock(dockerSource, "gates");
  const publish = jobBlock(dockerSource, "publish");

  if (!/^  workflow_call:\s*$/mu.test(ciSource)) {
    errors.push("ci.yml must expose workflow_call");
  }
  if (!hasNeed(integration, "validate")) {
    errors.push("integration must need validate");
  }
  if (!hasNeed(productionSmoke, "integration")) {
    errors.push("production-smoke must need integration");
  }
  if (!/^    uses:\s*\.\/\.github\/workflows\/ci\.yml\s*$/mu.test(gates)) {
    errors.push("release gates must call ci.yml");
  }
  if (!hasNeed(publish, "gates")) {
    errors.push("publish must need gates");
  }
  if (/^    if:\s*.*always\(\)/mu.test(publish)) {
    errors.push("publish must not bypass failed gates with always()");
  }
  for (const command of [
    "docker build --build-arg PNPM_OFFLINE=0",
    'docker push "shererpro/docmost:${VERSION}"',
    "docker push shererpro/docmost:latest",
  ]) {
    requireWorkflowCommand(errors, publish, "publish", command);
  }

  for (const jobName of Object.keys(REQUIRED_JOB_COMMANDS)) {
    requireJobCommands(errors, jobBlock(ciSource, jobName), jobName);
  }
  validateVerificationScripts(errors, packageJson);
  validateWorkflowHygiene(errors, workflowSources);
  validateAiGuideGateMetadata(errors, ciSource);

  return errors;
}

async function main() {
  const workflowDirectory = ".github/workflows";
  const workflowFiles = (await readdir(workflowDirectory)).filter((file) =>
    /\.ya?ml$/u.test(file),
  );
  const workflowSources = Object.fromEntries(
    await Promise.all(
      workflowFiles.map(async (file) => [
        file,
        await readFile(join(workflowDirectory, file), "utf8"),
      ]),
    ),
  );
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const errors = validateReleaseGateContract({
    ciSource: workflowSources["ci.yml"],
    dockerSource: workflowSources["docker.yml"],
    workflowSources,
    packageJson,
  });
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Release gate contract violation: ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Release gate contract is intact across ${workflowFiles.length} workflows.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
