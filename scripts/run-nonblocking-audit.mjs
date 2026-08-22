import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const auditCommands = {
  deps: [
    "depcruise",
    [
      "--config",
      ".dependency-cruiser.cjs",
      "apps/server/src",
      "apps/client/src",
      "packages/api-contract/src",
      "packages/editor-ext/src",
    ],
  ],
  "dead-code": ["knip", ["--config", "knip.json"]],
  duplicates: ["jscpd", ["--config", ".jscpd.json"]],
};

export function runAudit(
  name,
  {
    strict = false,
    spawn = spawnSync,
    platform = process.platform,
    cwd = process.cwd(),
    output = console,
  } = {},
) {
  const command = auditCommands[name];

  if (!command) {
    output.error(`Unknown audit target: ${name}`);
    return { name, status: "unknown_target", childExitCode: null, exitCode: 1 };
  }

  const [bin, args] = command;
  const result =
    platform === "win32"
      ? spawn(
          "cmd.exe",
          ["/d", "/s", "/c", [bin, ...args].map(quoteCmdArg).join(" ")],
          {
            cwd,
            stdio: "inherit",
          },
        )
      : spawn(bin, args, {
          cwd,
          stdio: "inherit",
        });

  let status = "passed";
  if (result.error) {
    status = "unavailable";
    output.warn(`Audit target "${name}" could not start: ${result.error}`);
  } else if (result.status !== 0) {
    status = "findings_or_failure";
    output.warn(
      `Audit target "${name}" reported findings or failed with exit code ${result.status}.`,
    );
  }

  const childExitCode = Number.isInteger(result.status) ? result.status : null;
  const exitCode = strict && status !== "passed" ? 1 : 0;
  output.log(
    `[audit:${name}] status=${status} childExit=${childExitCode ?? "none"} strict=${strict}`,
  );
  return { name, status, childExitCode, exitCode };
}

function quoteCmdArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '\\"')}"`;
}

export function runArchitectureAudit(options = {}) {
  const results = Object.keys(auditCommands).map((name) =>
    runAudit(name, options),
  );
  return {
    results,
    exitCode: results.some((result) => result.exitCode !== 0) ? 1 : 0,
  };
}

function main(argv) {
  const strict = argv.includes("--strict");
  const target = argv.find((value) => !value.startsWith("--"));
  const result =
    target === "architecture"
      ? runArchitectureAudit({ strict })
      : runAudit(target, { strict });
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main(process.argv.slice(2));
}
