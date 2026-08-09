import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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

export function validateReleaseGateContract({ ciSource, dockerSource }) {
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

  return errors;
}

async function main() {
  const [ciSource, dockerSource] = await Promise.all([
    readFile(".github/workflows/ci.yml", "utf8"),
    readFile(".github/workflows/docker.yml", "utf8"),
  ]);
  const errors = validateReleaseGateContract({ ciSource, dockerSource });
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Release gate contract violation: ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Release gate contract is intact.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
