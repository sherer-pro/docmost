import { spawnSync } from "node:child_process";

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

function runAudit(name) {
  const command = auditCommands[name];

  if (!command) {
    console.error(`Unknown audit target: ${name}`);
    process.exitCode = 1;
    return;
  }

  const [bin, args] = command;
  const result =
    process.platform === "win32"
      ? spawnSync(
          "cmd.exe",
          ["/d", "/s", "/c", [bin, ...args].map(quoteCmdArg).join(" ")],
          {
            cwd: process.cwd(),
            stdio: "inherit",
          },
        )
      : spawnSync(bin, args, {
          cwd: process.cwd(),
          stdio: "inherit",
        });

  if (result.error) {
    console.warn(`Audit target "${name}" could not start: ${result.error}`);
    return;
  }

  if (result.status && result.status !== 0) {
    console.warn(
      `Audit target "${name}" reported findings or failed with exit code ${result.status}.`,
    );
  }
}

function quoteCmdArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '\\"')}"`;
}

function runArchitectureAudit() {
  for (const name of Object.keys(auditCommands)) {
    runAudit(name);
  }
}

const target = process.argv[2];

if (target === "architecture") {
  runArchitectureAudit();
} else {
  runAudit(target);
}
