import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateReleaseVersionContract } from "./check-release-version.mjs";

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

function inputs(overrides = {}) {
  return {
    rootPackage: overrides.rootPackage ?? rootPackage,
    clientPackage: overrides.clientPackage ?? clientPackage,
    serverPackage: overrides.serverPackage ?? serverPackage,
    inboundMcpSource: overrides.inboundMcpSource ?? inboundMcpSource,
    outboundMcpSource: overrides.outboundMcpSource ?? outboundMcpSource,
    dockerSource: overrides.dockerSource ?? dockerSource,
  };
}

test("accepts the checked-in release version contract", () => {
  assert.deepEqual(validateReleaseVersionContract(inputs()), []);
});

test("rejects package manifest version drift", () => {
  const driftedVersion =
    clientPackage.version === "999.0.0" ? "998.0.0" : "999.0.0";
  const errors = validateReleaseVersionContract(
    inputs({ clientPackage: { ...clientPackage, version: driftedVersion } }),
  );
  assert.ok(
    errors.includes("root, client, and server package versions must match"),
  );
});

test("rejects an invalid semantic version", () => {
  const invalid = { ...rootPackage, version: "01.1.0" };
  const errors = validateReleaseVersionContract(
    inputs({
      rootPackage: invalid,
      clientPackage: invalid,
      serverPackage: invalid,
    }),
  );
  assert.ok(errors.includes("package.json must contain a valid semantic version"));
});

test("rejects hardcoded inbound and outbound MCP versions", () => {
  const inboundErrors = validateReleaseVersionContract(
    inputs({
      inboundMcpSource: inboundMcpSource.replace(
        "version: getAppVersion()",
        "version: '1.0.0'",
      ),
    }),
  );
  assert.ok(
    inboundErrors.includes("inbound MCP serverInfo.version must use getAppVersion()"),
  );
  assert.ok(
    inboundErrors.includes("inbound MCP serverInfo.version must not hardcode an MCP version"),
  );

  const outboundErrors = validateReleaseVersionContract(
    inputs({
      outboundMcpSource: outboundMcpSource.replace(
        "version: getAppVersion()",
        "version: '1.0.0'",
      ),
    }),
  );
  assert.ok(
    outboundErrors.includes("outbound MCP clientInfo.version must use getAppVersion()"),
  );
  assert.ok(
    outboundErrors.includes("outbound MCP clientInfo.version must not hardcode an MCP version"),
  );
});

test("rejects removal of the release tag and manifest equality check", () => {
  const errors = validateReleaseVersionContract(
    inputs({
      dockerSource: dockerSource.replace(
        '            test "$tag" = "$expected_tag"',
        "            true",
      ),
    }),
  );
  assert.ok(errors.includes("release workflow must require tag v${package.version}"));
});
