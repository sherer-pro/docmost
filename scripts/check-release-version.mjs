import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function isValidSemver(value) {
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u.exec(
    value,
  );
  if (!match) return false;

  for (const identifiers of [match[4], match[5]]) {
    if (identifiers?.split(".").some((identifier) => identifier.length === 0)) {
      return false;
    }
  }
  return !match[4]
    ?.split(".")
    .some((identifier) => /^0\d+$/u.test(identifier));
}

function validateMcpVersionSource(errors, label, source) {
  if (!/\bgetAppVersion\s*\(\s*\)/u.test(source)) {
    errors.push(`${label} must use getAppVersion()`);
  }
  if (/\bversion\s*:\s*["']\d+\.\d+\.\d+/u.test(source)) {
    errors.push(`${label} must not hardcode an MCP version`);
  }
}

export function validateReleaseVersionContract({
  rootPackage,
  clientPackage,
  serverPackage,
  inboundMcpSource,
  outboundMcpSource,
  dockerSource,
}) {
  const errors = [];
  const manifests = [
    ["package.json", rootPackage],
    ["apps/client/package.json", clientPackage],
    ["apps/server/package.json", serverPackage],
  ];

  for (const [path, manifest] of manifests) {
    if (!isValidSemver(manifest?.version)) {
      errors.push(`${path} must contain a valid semantic version`);
    }
  }

  const versions = new Set(manifests.map(([, manifest]) => manifest?.version));
  if (versions.size !== 1) {
    errors.push("root, client, and server package versions must match");
  }

  validateMcpVersionSource(errors, "inbound MCP serverInfo.version", inboundMcpSource);
  validateMcpVersionSource(errors, "outbound MCP clientInfo.version", outboundMcpSource);

  const releaseBranch = /if \[ "\$\{\{ github\.event_name \}\}" = "release" \]; then([\s\S]*?)\n\s*else/u.exec(
    dockerSource,
  )?.[1];
  if (
    !releaseBranch?.includes('tag="${{ github.event.release.tag_name }}"') ||
    !releaseBranch.includes('expected_tag="v${manifest_version}"') ||
    !releaseBranch.includes('test "$tag" = "$expected_tag"') ||
    !releaseBranch.includes('version="$manifest_version"')
  ) {
    errors.push("release workflow must require tag v${package.version}");
  }
  if (
    !dockerSource.includes(
      'manifest_version="$(node -p "require(\'./package.json\').version")"',
    )
  ) {
    errors.push("release workflow must read package.version");
  }

  return errors;
}

async function main() {
  const [
    rootPackage,
    clientPackage,
    serverPackage,
    inboundMcpSource,
    outboundMcpSource,
    dockerSource,
  ] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("apps/client/package.json", "utf8").then(JSON.parse),
    readFile("apps/server/package.json", "utf8").then(JSON.parse),
    readFile("apps/server/src/core/mcp/mcp.controller.ts", "utf8"),
    readFile(
      "apps/server/src/core/ai/mcp/ai-mcp-client-pool.service.ts",
      "utf8",
    ),
    readFile(".github/workflows/docker.yml", "utf8"),
  ]);

  const errors = validateReleaseVersionContract({
    rootPackage,
    clientPackage,
    serverPackage,
    inboundMcpSource,
    outboundMcpSource,
    dockerSource,
  });
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Release version contract violation: ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Release version contract is valid for ${rootPackage.version}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
