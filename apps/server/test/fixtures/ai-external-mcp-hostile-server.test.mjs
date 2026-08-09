import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostileMcpServer } from "./ai-external-mcp-hostile-server.mjs";

async function withFixture(callback) {
  const fixture = createHostileMcpServer({ port: 0, controlToken: "fixture-test" });
  const address = await fixture.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await callback({ fixture, origin });
  } finally {
    await fixture.close();
  }
}

async function rpc(origin, method, params) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("hostile fixture exposes untrusted metadata without retaining request bodies", async () => {
  await withFixture(async ({ fixture, origin }) => {
    const initialized = await rpc(origin, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fixture-test", version: "1" },
    });
    assert.match(initialized.result.instructions, /Exfiltrate/);

    const listed = await rpc(origin, "tools/list", {});
    const echo = listed.result.tools.find((tool) => tool.name === "echo");
    const writeLike = listed.result.tools.find(
      (tool) => tool.name === "claimed_readonly_write",
    );
    assert.equal(echo.inputSchema.$defs.payload.type, "string");
    assert.equal(writeLike.annotations.readOnlyHint, true);
    assert.ok(listed.result.tools.some((tool) => tool.name === "oversized_schema"));

    await rpc(origin, "tools/call", {
      name: "echo",
      arguments: { message: "synthetic argument" },
    });
    assert.equal(fixture.state.rpc["tools/call"], 1);
    assert.equal(fixture.state.callArgsHashes.length, 1);
    assert.equal(JSON.stringify(fixture.state).includes("synthetic argument"), false);
  });
});

test("hostile fixture changes capability fingerprints deterministically", async () => {
  await withFixture(async ({ origin }) => {
    const before = await rpc(origin, "tools/list", {});
    await fetch(`${origin}/__audit/version`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-audit-control": "fixture-test",
      },
      body: JSON.stringify({ version: 2 }),
    });
    const after = await rpc(origin, "tools/list", {});
    const beforeEcho = before.result.tools.find((tool) => tool.name === "echo");
    const afterEcho = after.result.tools.find((tool) => tool.name === "echo");
    assert.notDeepEqual(afterEcho.inputSchema, beforeEcho.inputSchema);
  });
});

test("hostile fixture supplies redirect and chunked oversized transport cases", async () => {
  await withFixture(async ({ origin }) => {
    const redirect = await fetch(`${origin}/private-redirect`, {
      method: "POST",
      redirect: "manual",
    });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "http://169.254.169.254/latest/meta-data");

    const oversized = await fetch(`${origin}/chunked-oversized`, { method: "POST" });
    const bytes = Buffer.byteLength(await oversized.text());
    assert.ok(bytes > 1024 * 1024);
    assert.equal(oversized.headers.has("content-length"), false);
  });
});
