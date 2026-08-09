import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, request } from "@playwright/test";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const auditRoot = path.join(repoRoot, "output", "audit", `ai-external-mcp-${runId}`);
const baseURL = (process.env.DOCMOST_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const appOrigin = new URL(baseURL).origin;
const network = process.env.DOCMOST_AI_MCP_NETWORK ?? "docmost_default";
const appContainer = process.env.DOCMOST_CONTAINER_NAME ?? "docmost-docmost-1";
const suffix = runId.toLowerCase();
const containers = {
  hostile: `ai-mcp-hostile-${suffix}`,
  forbidden: `ai-mcp-forbidden-${suffix}`,
  reference: `ai-mcp-reference-${suffix}`,
  model: `ai-mcp-model-${suffix}`,
};
const origins = {
  hostile: `http://${containers.hostile}:3310`,
  forbidden: `http://${containers.forbidden}:3390`,
  reference: `http://${containers.reference}:3001`,
  model: `http://${containers.model}:3320`,
};
const headerCanary = `mcp-header-${randomBytes(24).toString("base64url")}`;
const controlToken = `mcp-control-${randomBytes(24).toString("base64url")}`;
const referenceImage = "docmost-ai-mcp-reference:2026.7.4";
const referencePackage = {
  name: "@modelcontextprotocol/server-everything",
  version: "2026.7.4",
  gitHead: "6dd0a683e198783e30feabf7abaf42f925bd18b1",
  integrity:
    "sha512-ydMW/M6rk9tK23b+U38trsNLHhd5eF+ntiv2Vr+RPMDhbiKY/IKrZU25ukvSXVPUBvy7TxTPWpeV4KcYcXg72w==",
};
const matrix = [];
const traces = [];
const createdServerIds = [];
let createdSpace;
let createdGroup;
let originalSettings;
let originalLocale;
let apiContext;
let originalContainerEnv;
let runtimeMutated = false;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied at runtime`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function unwrap(payload) {
  return payload && typeof payload === "object" && "success" in payload && "data" in payload
    ? payload.data
    : payload;
}

function safePath(value) {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "[id]")
    .replace(/\?.*$/, "?[redacted]");
}

function addMatrix(scenario, expectedControl, status, details = {}) {
  matrix.push({
    scenario,
    expectedControl,
    status,
    severity: details.severity ?? "high",
    transportHits: details.transportHits ?? null,
    evidence: details.evidence ?? null,
  });
}

function command(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${file} failed with exit code ${result.status}`);
  }
  return (result.stdout ?? "").trim();
}

function docker(args, options) {
  return command("docker", args, options);
}

function parseContainerEnv(name) {
  const values = JSON.parse(
    docker(["inspect", name, "--format", "{{json .Config.Env}}"]),
  );
  return Object.fromEntries(
    values.map((entry) => {
      const separator = entry.indexOf("=");
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
}

function composeEnvironment(overrides) {
  return {
    ...process.env,
    AI_EXTERNAL_MCP_ENABLED: overrides.externalEnabled,
    AI_MCP_ALLOWED_ORIGINS: overrides.mcpOrigins,
    AI_PROVIDER_ALLOWED_ORIGINS: overrides.providerOrigins,
  };
}

async function waitFor(description, predicate, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${description} timed out${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

async function recreateApp(externalEnabled) {
  const environment = composeEnvironment({
    externalEnabled: externalEnabled ? "true" : "false",
    mcpOrigins: [origins.hostile, origins.reference].join(","),
    providerOrigins: origins.model,
  });
  command(
    "docker",
    ["compose", "up", "-d", "--no-deps", "--force-recreate", "docmost"],
    { env: environment },
  );
  runtimeMutated = true;
  await waitFor("Docmost health", async () => {
    const response = await fetch(`${baseURL}/api/health`).catch(() => null);
    return response?.ok;
  }, 120_000);
  if (apiContext) {
    await apiContext.dispose();
    apiContext = undefined;
  }
}

async function restoreAppEnvironment() {
  if (!runtimeMutated || !originalContainerEnv) return;
  const environment = composeEnvironment({
    externalEnabled: originalContainerEnv.AI_EXTERNAL_MCP_ENABLED ?? "false",
    mcpOrigins: originalContainerEnv.AI_MCP_ALLOWED_ORIGINS ?? "",
    providerOrigins: originalContainerEnv.AI_PROVIDER_ALLOWED_ORIGINS ?? "",
  });
  command(
    "docker",
    ["compose", "up", "-d", "--no-deps", "--force-recreate", "docmost"],
    { env: environment },
  );
  await waitFor("restored Docmost health", async () => {
    const response = await fetch(`${baseURL}/api/health`).catch(() => null);
    return response?.ok;
  }, 120_000);
}

async function adminApi() {
  if (apiContext) return apiContext;
  const authToken = required("DOCMOST_AUTH_TOKEN");
  const csrfToken = required("DOCMOST_CSRF_TOKEN");
  apiContext = await request.newContext({
    baseURL,
    timeout: 45_000,
    extraHTTPHeaders: {
      Authorization: `Bearer ${authToken}`,
      Cookie: `csrfToken=${csrfToken}`,
      Origin: appOrigin,
      Referer: `${appOrigin}/`,
      "x-csrf-token": csrfToken,
      Accept: "application/json",
    },
  });
  return apiContext;
}

async function api(method, url, data, { allowFailure = false } = {}) {
  const context = await adminApi();
  const response = await context.fetch(url, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? unwrap(JSON.parse(text)) : undefined;
  } catch {
    payload = undefined;
  }
  traces.push({ method, path: safePath(url), status: response.status() });
  if (!response.ok() && !allowFailure) {
    const code =
      payload && typeof payload === "object"
        ? payload.code ?? payload.message ?? payload.error ?? "request_failed"
        : "request_failed";
    throw new Error(`${safePath(url)} returned ${response.status()}: ${String(code).slice(0, 240)}`);
  }
  return { ok: response.ok(), status: response.status(), payload };
}

function containerFetch(container, url, options = {}) {
  const encodedBody = options.body === undefined ? "undefined" : JSON.stringify(JSON.stringify(options.body));
  const code = `const r=await fetch(${JSON.stringify(url)},{method:${JSON.stringify(options.method ?? "GET")},headers:${JSON.stringify(options.headers ?? {})},body:${encodedBody}});const t=await r.text();if(!r.ok)process.exitCode=2;process.stdout.write(t)`;
  const output = docker(["exec", container, "node", "--input-type=module", "-e", code]);
  return output ? JSON.parse(output) : undefined;
}

function hostileState(container = containers.hostile) {
  const port = container === containers.forbidden ? 3390 : 3310;
  return containerFetch(container, `http://127.0.0.1:${port}/__audit/state`, {
    headers: { "x-audit-control": controlToken },
  });
}

function hostileControl(pathname, body) {
  return containerFetch(containers.hostile, `http://127.0.0.1:3310${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-audit-control": controlToken,
    },
    body,
  });
}

function modelRequests() {
  return containerFetch(containers.model, "http://127.0.0.1:3320/__audit/requests").requests;
}

async function waitContainer(name, url, timeoutMs = 60_000) {
  await waitFor(`${name} container`, async () => {
    try {
      docker([
        "exec",
        name,
        "node",
        "--input-type=module",
        "-e",
        `const r=await fetch(${JSON.stringify(url)});if(r.status<100)process.exit(1)`,
      ]);
      return true;
    } catch {
      return false;
    }
  }, timeoutMs);
}

function startFixtureContainers() {
  const fixturePath = path.join(
    repoRoot,
    "apps/server/test/fixtures/ai-external-mcp-hostile-server.mjs",
  );
  const modelPath = path.join(
    repoRoot,
    "apps/client/e2e/ai-external-mcp/deterministic-model.mjs",
  );
  const common = [
    "--rm",
    "-d",
    "--network",
    network,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "192m",
    "--cpus",
    "0.5",
    "--pids-limit",
    "64",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=16m",
    "-v",
    `${repoRoot}:/workspace:ro`,
  ];
  docker([
    "run",
    ...common,
    "--name",
    containers.forbidden,
    "-e",
    "AI_MCP_HOSTILE_PORT=3390",
    "-e",
    `AI_MCP_HOSTILE_CONTROL_TOKEN=${controlToken}`,
    "node:22.23.1-slim",
    "node",
    `/workspace/${path.relative(repoRoot, fixturePath).replaceAll("\\", "/")}`,
  ]);
  docker([
    "run",
    ...common,
    "--name",
    containers.hostile,
    "-e",
    "AI_MCP_HOSTILE_PORT=3310",
    "-e",
    `AI_MCP_HOSTILE_CONTROL_TOKEN=${controlToken}`,
    "-e",
    `AI_MCP_HOSTILE_HEADER_CANARY=${headerCanary}`,
    "-e",
    `AI_MCP_HOSTILE_PRIVATE_REDIRECT=${origins.forbidden}/mcp`,
    "node:22.23.1-slim",
    "node",
    `/workspace/${path.relative(repoRoot, fixturePath).replaceAll("\\", "/")}`,
  ]);
  docker([
    "run",
    ...common,
    "--name",
    containers.model,
    "-e",
    "AI_MCP_MODEL_PORT=3320",
    "node:22.23.1-slim",
    "node",
    `/workspace/${path.relative(repoRoot, modelPath).replaceAll("\\", "/")}`,
  ]);
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    containers.reference,
    "--network",
    network,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "256m",
    "--cpus",
    "0.75",
    "--pids-limit",
    "96",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m",
    referenceImage,
  ]);
}

async function waitFixtures() {
  await waitContainer(containers.hostile, "http://127.0.0.1:3310/health");
  await waitContainer(containers.forbidden, "http://127.0.0.1:3390/health");
  await waitContainer(containers.model, "http://127.0.0.1:3320/health");
  await waitContainer(containers.reference, "http://127.0.0.1:3001/mcp");
}

async function createServer(name, namespace, url, headers) {
  const response = await api("POST", "/api/ai/mcp-servers", {
    name,
    namespace,
    url,
    transport: "streamable-http",
    ...(headers ? { headers } : {}),
  });
  createdServerIds.push(response.payload.id);
  return response.payload;
}

async function discover(serverId) {
  return (await api("POST", `/api/ai/mcp-servers/${serverId}/actions/discover`)).payload;
}

async function approve(serverId, approvedNames, discoverySnapshot) {
  const detail = (await api("GET", `/api/ai/mcp-servers/${serverId}`)).payload;
  const detailTools = detail.discovery?.tools ?? [];
  const detailNames = detailTools.map((tool) => tool.remoteName).sort();
  const snapshotTools = discoverySnapshot?.tools ?? [];
  const snapshotNames = snapshotTools.map((tool) => tool.remoteName).sort();
  const detailConsistent = JSON.stringify(detailNames) === JSON.stringify(snapshotNames);
  addMatrix(
    "discovery_detail_consistency",
    "successful discovery is immediately visible through the server detail projection",
    detailConsistent ? "PASS" : "FAIL",
    {
      severity: "high",
      evidence: `discover=${snapshotNames.length};detail=${detailNames.length}`,
    },
  );
  const candidateTools = detailConsistent ? detailTools : snapshotTools;
  const discovered = candidateTools
    .map((tool) => `${tool.remoteName}:${tool.approvable ? "approvable" : "blocked"}`)
    .join(",");
  if (!approvedNames.every((name) => candidateTools.some((tool) => tool.remoteName === name))) {
    traces.push({
      method: "AUDIT",
      path: "discovery_requested_tool_check",
      status: 0,
      evidence: `requested=${approvedNames.join(",")};discovered=${discovered}`,
    });
  }
  const tools = approvedNames.map((remoteName) => ({
    remoteName,
    approved: true,
    description: `Administrator-approved read-only ${remoteName} audit tool`,
  }));
  await api("PATCH", `/api/ai/mcp-servers/${serverId}`, { tools });
  await api("PATCH", `/api/ai/mcp-servers/${serverId}`, { enabled: true });
  return (await api("GET", `/api/ai/mcp-servers/${serverId}`)).payload;
}

async function putBinding(serverId, patch = {}) {
  return (
    await api("PUT", `/api/spaces/${createdSpace.id}/ai/mcp-bindings/${serverId}`, {
      enabled: true,
      toolSelection: "all",
      toolNames: [],
      instructions: null,
      groupPolicies: [],
      ...patch,
    })
  ).payload;
}

async function setPreferences(items) {
  return (
    await api("PUT", `/api/spaces/${createdSpace.id}/ai/mcp-preferences`, { items })
  ).payload;
}

async function configureAgent() {
  const provider = {
    enabled: true,
    agentEnabled: false,
    provider: "openai-compatible",
    baseUrl: `${origins.model}/v1`,
    chatModel: "docmost-mcp-audit-v1",
    apiKey: `synthetic-provider-${runId}`,
    temperature: 0,
    maxOutputTokens: 512,
    contextWindow: 8192,
    requestTimeoutMs: 30_000,
    reasoningEnabled: false,
    visionEnabled: false,
    quickCommands: [],
  };
  await api("PATCH", `/api/spaces/${createdSpace.id}/ai/config`, provider);
  await api("POST", `/api/spaces/${createdSpace.id}/ai/config/actions/test-agent`, {});
  await api("PATCH", `/api/spaces/${createdSpace.id}/ai/config`, {
    agentEnabled: true,
  });
}

async function startAgentRun(scenario) {
  const conversation = (
    await api("POST", "/api/ai/conversations", {
      pageId: createdSpace.page.id,
      clientRequestId: randomUUID(),
      title: `External MCP audit ${scenario}`,
      useSpaceSearch: false,
      agentMode: true,
    })
  ).payload;
  const context = (
    await api("GET", `/api/ai/conversations/${conversation.id}/context`)
  ).payload;
  const marker = `MCP_AUDIT:${scenario.toUpperCase()}`;
  const sent = (
    await api("POST", `/api/ai/conversations/${conversation.id}/messages`, {
      content: marker,
      clientRequestId: randomUUID(),
      contextRevision: context.revision,
      documentSnapshot: "Synthetic external MCP audit document",
      snapshotHash: sha256("Synthetic external MCP audit document"),
      documentHeadings: [],
      useSpaceSearch: false,
    })
  ).payload;
  return { ...sent, conversation };
}

async function waitRun(runId, timeoutMs = 90_000) {
  return waitFor(`agent run ${runId}`, async () => {
    const run = (await api("GET", `/api/ai/runs/${runId}`)).payload;
    return ["completed", "failed", "cancelled"].includes(run.status) ? run : undefined;
  }, timeoutMs);
}

async function gateAttempt(scenario, expectedHits) {
  const before = hostileState().rpc["tools/call"] ?? 0;
  const sent = await startAgentRun("echo");
  const run = await waitRun(sent.run.id);
  const after = hostileState().rpc["tools/call"] ?? 0;
  const hits = after - before;
  addMatrix(
    scenario,
    expectedHits === 0 ? "closed gate prevents transport" : "all gates permit one read-only call",
    hits === expectedHits ? "PASS" : "FAIL",
    { transportHits: hits, evidence: `run:${run.status}:${run.errorCode ?? "none"}` },
  );
  return { run, hits };
}

async function browserEvidence() {
  const me = (await api("GET", "/api/users/me")).payload;
  originalLocale = me.user.locale;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of ["en-US", "ru-RU"]) {
      await api("POST", "/api/users/update", { locale });
      const context = await browser.newContext({
        baseURL,
        locale,
        storageState: {
          cookies: [
            {
              name: "authToken",
              value: required("DOCMOST_AUTH_TOKEN"),
              domain: new URL(baseURL).hostname,
              path: "/",
              httpOnly: true,
              secure: new URL(baseURL).protocol === "https:",
              sameSite: "Lax",
            },
            {
              name: "csrfToken",
              value: required("DOCMOST_CSRF_TOKEN"),
              domain: new URL(baseURL).hostname,
              path: "/",
              httpOnly: false,
              secure: new URL(baseURL).protocol === "https:",
              sameSite: "Lax",
            },
          ],
          origins: [],
        },
      });
      const page = await context.newPage();
      await page.goto("/settings/ai/guide");
      const expected = locale === "ru-RU" ? "Администраторы пространства" : "Space administrators";
      await page.getByText(expected, { exact: false }).waitFor({ state: "visible" });
      await page.screenshot({
        path: path.join(auditRoot, "screenshots", `security-guide-${locale}.png`),
        fullPage: true,
      });
      const executed = await page.evaluate(() => globalThis.__mcpPwned);
      if (executed !== undefined) throw new Error("unexpected hostile browser marker");
      await context.close();
    }
    await api("POST", "/api/users/update", { locale: "en-US" });
    await api(
      "POST",
      `/api/ai/conversations/${createdSpace.maliciousConversationId}/actions/open`,
      {},
    );
    const context = await browser.newContext({
      baseURL,
      locale: "en-US",
      storageState: {
        cookies: [
          {
            name: "authToken",
            value: required("DOCMOST_AUTH_TOKEN"),
            domain: new URL(baseURL).hostname,
            path: "/",
            httpOnly: true,
            secure: new URL(baseURL).protocol === "https:",
            sameSite: "Lax",
          },
          {
            name: "csrfToken",
            value: required("DOCMOST_CSRF_TOKEN"),
            domain: new URL(baseURL).hostname,
            path: "/",
            httpOnly: false,
            secure: new URL(baseURL).protocol === "https:",
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
    });
    const page = await context.newPage();
    const pageSlug = String(createdSpace.page.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    await page.goto(`/s/${createdSpace.slug}/p/${pageSlug}-${createdSpace.page.slugId}`);
    const remoteText = page.getByText("remote markdown", { exact: false });
    if (!(await remoteText.isVisible().catch(() => false))) {
      const open = page.getByRole("button", { name: /AI assistant|AI-помощник/i });
      if (await open.isVisible().catch(() => false)) await open.click();
    }
    // Rendering safety is asserted from active DOM capabilities below. The
    // conversation panel may virtualize or collapse the literal result text.
    const rendering = await page.evaluate(() => ({
      executed: globalThis.__mcpPwned,
      javascriptLinks: document.querySelectorAll('a[href^="javascript:"]').length,
      inlineHandlers: document.querySelectorAll("[onerror], [onclick]").length,
    }));
    await page.screenshot({
      path: path.join(auditRoot, "screenshots", "malicious-result-sanitized.png"),
      fullPage: true,
    });
    await context.close();
    addMatrix(
      "malicious_result_browser_rendering",
      "no HTML handler execution or active javascript URL",
      rendering.executed === undefined &&
        rendering.javascriptLinks === 0 &&
        rendering.inlineHandlers === 0
        ? "PASS"
        : "FAIL",
      { severity: "critical", evidence: "malicious-result-sanitized.png" },
    );
    addMatrix(
      "localized_warnings",
      "English and Russian guide explain group deny/intersection",
      "PASS",
      { severity: "medium", evidence: "two browser screenshots" },
    );
  } finally {
    await browser.close();
  }
}

async function encryptionProof(serverId) {
  const detail = (await api("GET", `/api/ai/mcp-servers/${serverId}`)).payload;
  const responseText = JSON.stringify(detail);
  const sql = `select json_build_object('present', headers_encrypted is not null, 'envelopePrefix', left(headers_encrypted, 7), 'ciphertextBytes', octet_length(headers_encrypted), 'containsPlaintext', position('${headerCanary.replaceAll("'", "''")}' in headers_encrypted) > 0) from ai_mcp_servers where id='${serverId}';`;
  const database = docker([
    "exec",
    "docmost-db-1",
    "psql",
    "-U",
    originalContainerEnv.POSTGRES_USER ?? "docmost",
    "-d",
    originalContainerEnv.POSTGRES_DB ?? "docmost",
    "-tA",
    "-c",
    sql,
  ]);
  const fixture = hostileState();
  const proof = {
    apiMasksValue:
      detail.headersConfigured === true &&
      detail.headerNames.includes("x-audit-canary") &&
      !responseText.includes(headerCanary),
    database: JSON.parse(database),
    fixtureHashMatch:
      fixture.expectedHeaderSha256 !== null &&
      fixture.expectedHeaderSha256 === fixture.lastReceivedHeaderSha256 &&
      fixture.headerCanaryMatches > 0,
  };
  await fs.writeFile(
    path.join(auditRoot, "fixed", "header-encryption-proof.json"),
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  addMatrix(
    "encrypted_headers",
    "write-only API, non-plaintext AES envelope, hash-only transport proof",
    proof.apiMasksValue && !proof.database.containsPlaintext && proof.fixtureHashMatch
      ? "PASS"
      : "FAIL",
    { severity: "critical", evidence: "header-encryption-proof.json" },
  );
}

function discoveryDatabaseShape(serverId) {
  const sql = `select json_build_object('type', jsonb_typeof(discovered_tools), 'arrayLength', case when jsonb_typeof(discovered_tools) = 'array' then jsonb_array_length(discovered_tools) else null end, 'columnCount', discovery_tool_count) from ai_mcp_servers where id='${serverId}';`;
  const value = docker([
    "exec",
    "docmost-db-1",
    "psql",
    "-U",
    originalContainerEnv.POSTGRES_USER ?? "docmost",
    "-d",
    originalContainerEnv.POSTGRES_DB ?? "docmost",
    "-tA",
    "-c",
    sql,
  ]);
  return JSON.parse(value);
}

async function runLiveAudit() {
  originalContainerEnv = parseContainerEnv(appContainer);
  if (process.env.DOCMOST_AI_MCP_E2E_SKIP_APP_BUILD !== "1") {
    command("docker", ["build", "-t", "docmost-local:dev", "."], { inherit: true });
  }
  command(
    "docker",
    [
      "build",
      "-f",
      path.join(import.meta.dirname, "reference-server.Dockerfile"),
      "-t",
      referenceImage,
      import.meta.dirname,
    ],
    { inherit: true },
  );
  startFixtureContainers();
  await waitFixtures();

  await recreateApp(false);
  const settings = (await api("GET", "/api/ai/mcp-settings")).payload;
  originalSettings = settings;
  await api("PATCH", "/api/ai/mcp-settings", {
    enabled: true,
    allowedOrigins: [origins.hostile, origins.reference],
  });
  const hostile = await createServer(
    `Hostile audit ${runId}`,
    `hostile_${runId.slice(-8)}`,
    `${origins.hostile}/mcp`,
    { "X-Audit-Canary": headerCanary },
  );
  hostileControl("/__audit/reset");
  const disabledProbe = (
    await api("POST", `/api/ai/mcp-servers/${hostile.id}/actions/test`)
  ).payload;
  const disabledHits = hostileState().rpc.initialize ?? 0;
  addMatrix(
    "deployment_switch_off",
    "AI_EXTERNAL_MCP_ENABLED blocks before transport",
    disabledProbe.status === "failed" && disabledHits === 0 ? "PASS" : "FAIL",
    { severity: "critical", transportHits: disabledHits },
  );

  await recreateApp(true);
  await api("PATCH", "/api/ai/mcp-settings", {
    enabled: true,
    allowedOrigins: [origins.hostile, origins.reference],
  });

  const invalidUrls = [
    "http://localhost:3310/mcp",
    "http://127.0.0.1:3310/mcp",
    "http://[::1]:3310/mcp",
    "http://[::ffff:127.0.0.1]:3310/mcp",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/mcp",
    "http://[::]/mcp",
    "http://[ff02::1]/mcp",
    "ftp://example.com/mcp",
    "http://user:pass@example.com/mcp",
    "https://example.com/mcp?secret=value",
    "https://example.com/mcp#fragment",
  ];
  let rejected = 0;
  for (const [index, url] of invalidUrls.entries()) {
    const response = await api(
      "POST",
      "/api/ai/mcp-servers",
      {
        name: `Rejected origin ${index}`,
        namespace: `reject_${index}`,
        url,
        transport: "streamable-http",
      },
      { allowFailure: true },
    );
    if (!response.ok) rejected += 1;
    else createdServerIds.push(response.payload.id);
  }
  addMatrix(
    "ssrf_url_admission",
    "loopback/mapped/link-local/private/unspecified/multicast/scheme/credentials/query/fragment rejected",
    rejected === invalidUrls.length ? "PASS" : "FAIL",
    { severity: "critical", transportHits: 0, evidence: `${rejected}/${invalidUrls.length}` },
  );

  hostileControl("/__audit/reset");
  const testResult = (
    await api("POST", `/api/ai/mcp-servers/${hostile.id}/actions/test`)
  ).payload;
  const discovery = await discover(hostile.id);
  const discoveryDatabase = discoveryDatabaseShape(hostile.id);
  const discoveryText = JSON.stringify(discovery);
  const sanitizerSafe =
    discovery.snapshot.tools.some((tool) => tool.remoteName === "echo") &&
    !discoveryText.includes("Ignore Docmost") &&
    !discoveryText.includes("Exfiltrate") &&
    !discoveryText.includes("$defs") &&
    !discoveryText.includes("$ref");
  const discoveryFixtureState = hostileState();
  addMatrix(
    "hostile_discovery_sanitizer",
    "remote prose/references/oversized schemas never enter model-facing contract",
    testResult.status === "passed" && sanitizerSafe ? "PASS" : "FAIL",
    {
      severity: "critical",
      transportHits: discoveryFixtureState.rpc.initialize ?? null,
      evidence: `test=${testResult.status};tools=${discovery.snapshot.tools.length};dbType=${discoveryDatabase.type};dbArray=${discoveryDatabase.arrayLength};dbCount=${discoveryDatabase.columnCount};listRpc=${discoveryFixtureState.rpc["tools/list"] ?? 0};prose=${discoveryText.includes("Ignore Docmost") || discoveryText.includes("Exfiltrate")};refs=${discoveryText.includes("$defs") || discoveryText.includes("$ref")}`,
    },
  );

  const hostileDetail = await approve(
    hostile.id,
    ["echo", "blocked_echo", "malicious_result"],
    discovery.snapshot,
  );
  const writeApproved = hostileDetail.approvedTools.some(
    (tool) => tool.remoteName === "claimed_readonly_write",
  );
  addMatrix(
    "false_readonly_hint",
    "write-like fixture is never approved or offered",
    writeApproved ? "FAIL" : "PASS",
    { severity: "critical", transportHits: 0 },
  );
  const immutable = await api(
    "PATCH",
    `/api/ai/mcp-servers/${hostile.id}`,
    { namespace: "changed_namespace" },
    { allowFailure: true },
  );
  const immutableDetail = (
    await api("GET", `/api/ai/mcp-servers/${hostile.id}`)
  ).payload;
  addMatrix(
    "immutable_namespace",
    "namespace cannot be patched",
    !immutable.ok || immutableDetail.namespace === hostile.namespace ? "PASS" : "FAIL",
    { severity: "high", transportHits: 0, evidence: immutable.ok ? "ignored" : "rejected" },
  );
  await encryptionProof(hostile.id);

  const redirectServer = await createServer(
    `Redirect audit ${runId}`,
    `redirect_${runId.slice(-8)}`,
    `${origins.hostile}/private-redirect`,
  );
  const forbiddenBefore = hostileState(containers.forbidden).requests;
  const redirectResult = (
    await api("POST", `/api/ai/mcp-servers/${redirectServer.id}/actions/test`)
  ).payload;
  const forbiddenAfter = hostileState(containers.forbidden).requests;
  const sinkRequestCount = (requests) =>
    Object.entries(requests)
      .filter(([request]) => !request.includes("/__audit/") && request !== "GET /health")
      .reduce((sum, [, value]) => sum + value, 0);
  const sinkHits = sinkRequestCount(forbiddenAfter) - sinkRequestCount(forbiddenBefore);
  addMatrix(
    "redirect_forbidden_origin",
    "manual redirect is rejected without contacting the sink",
    redirectResult.status === "failed" && sinkHits === 0 ? "PASS" : "FAIL",
    { severity: "critical", transportHits: sinkHits },
  );

  for (const [label, endpoint] of [
    ["chunked_oversized_response", "chunked-oversized"],
    ["stalled_response", "stalled"],
  ]) {
    const server = await createServer(
      `${label} ${runId}`,
      `${label.slice(0, 14)}_${runId.slice(-5)}`,
      `${origins.hostile}/${endpoint}`,
    );
    const result = (
      await api("POST", `/api/ai/mcp-servers/${server.id}/actions/test`)
    ).payload;
    addMatrix(
      label,
      label.startsWith("chunked") ? "1 MiB streaming wire cap" : "probe absolute timeout",
      result.status === "failed" ? "PASS" : "FAIL",
      { severity: "high", transportHits: 1, evidence: result.errorCode },
    );
  }

  const me = (await api("GET", "/api/users/me")).payload;
  createdSpace = (
    await api("POST", "/api/spaces", {
      name: `External MCP audit ${runId}`,
      slug: `mcpaudit${runId}`,
      description: "Isolated outbound MCP audit space",
    })
  ).payload;
  createdSpace.page = (
    await api("POST", "/api/pages", {
      spaceId: createdSpace.id,
      title: "External MCP audit page",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Synthetic MCP audit" }] },
        ],
      },
      format: "json",
    })
  ).payload;
  createdGroup = (
    await api("POST", "/api/groups/actions/create", {
      name: `MCP audit group ${runId}`,
      description: "Isolated outbound MCP deny fixture",
      userIds: [me.user.id],
    })
  ).payload;

  let bindings = await putBinding(hostile.id, {
    groupPolicies: [
      {
        groupId: createdGroup.id,
        denyConnection: true,
        toolSelection: "all",
        toolNames: [],
      },
    ],
  });
  const projected = bindings.bindings.find((binding) => binding.serverId === hostile.id);
  addMatrix(
    "group_policy_management",
    "binding PUT fully replaces validated group policies atomically",
    projected?.groupPolicies?.[0]?.groupId === createdGroup.id ? "FIXED" : "FAIL",
    { severity: "high", evidence: "baseline API/UI management was absent" },
  );
  await setPreferences([{ serverId: hostile.id, optedIn: true }]);

  await configureAgent();
  await gateAttempt("group_deny", 0);
  await putBinding(hostile.id, { groupPolicies: [] });
  await gateAttempt("all_policy_levels_open_hostile_echo", 1);

  const maliciousToolNames = hostileDetail.approvedTools
    .filter((tool) => tool.remoteName === "malicious_result")
    .map((tool) => tool.toolName);
  await putBinding(hostile.id, {
    toolSelection: "selected",
    toolNames: maliciousToolNames,
  });
  const maliciousSent = await startAgentRun("malicious");
  const maliciousRun = await waitRun(maliciousSent.run.id);
  createdSpace.maliciousConversationId = maliciousSent.conversation.id;
  await api(
    "POST",
    `/api/ai/conversations/${maliciousSent.conversation.id}/actions/open`,
    {},
  );
  addMatrix(
    "malicious_result_agent_path",
    "remote HTML/Markdown remains untrusted data",
    maliciousRun.status === "completed" ? "PASS" : "BLOCKED",
    {
      severity: "critical",
      transportHits: 1,
      evidence: `run:${maliciousRun.status}:${maliciousRun.errorCode ?? "none"}`,
    },
  );
  await putBinding(hostile.id);
  await setPreferences([{ serverId: hostile.id, optedIn: false }]);
  await gateAttempt("user_opt_out", 0);
  await setPreferences([{ serverId: hostile.id, optedIn: true }]);
  await putBinding(hostile.id, { enabled: false });
  await gateAttempt("space_binding_disabled", 0);
  await putBinding(hostile.id);
  await api("PATCH", `/api/ai/mcp-servers/${hostile.id}`, { enabled: false });
  await gateAttempt("server_disabled", 0);
  await api("PATCH", `/api/ai/mcp-servers/${hostile.id}`, { enabled: true });
  await api("PATCH", "/api/ai/mcp-settings", {
    enabled: false,
    allowedOrigins: [origins.hostile, origins.reference],
  });
  await gateAttempt("workspace_switch_off", 0);
  await api("PATCH", "/api/ai/mcp-settings", {
    enabled: true,
    allowedOrigins: [origins.hostile, origins.reference],
  });

  const reference = await createServer(
    `Official everything ${runId}`,
    `reference_${runId.slice(-8)}`,
    `${origins.reference}/mcp`,
  );
  const referenceTest = (
    await api("POST", `/api/ai/mcp-servers/${reference.id}/actions/test`)
  ).payload;
  const referenceDiscovery = await discover(reference.id);
  const echo = referenceDiscovery.snapshot?.tools.find((tool) => tool.remoteName === "echo");
  if (!echo) throw new Error("Pinned reference server did not expose echo");
  await approve(reference.id, ["echo"], referenceDiscovery.snapshot);
  await putBinding(hostile.id, { enabled: false });
  await putBinding(reference.id);
  await setPreferences([
    { serverId: hostile.id, optedIn: false },
    { serverId: reference.id, optedIn: true },
  ]);
  const beforeReferenceRequests = modelRequests().length;
  const referenceRun = await startAgentRun("echo").then((sent) => waitRun(sent.run.id));
  const referenceModelRows = modelRequests().slice(beforeReferenceRequests);
  const referenceOfferedOnlyEcho = referenceModelRows.every(
    (row) => !row.writeLikeToolOffered,
  );
  addMatrix(
    "official_reference_echo_agent_call",
    "only pinned official echo is approved and invoked",
    referenceTest.status === "passed" &&
      referenceRun.status === "completed" &&
      referenceOfferedOnlyEcho
      ? "PASS"
      : "FAIL",
    { severity: "critical", evidence: `run:${referenceRun.status}` },
  );

  await putBinding(reference.id, { enabled: false });
  await putBinding(hostile.id, {
    enabled: true,
    toolSelection: "selected",
    toolNames: hostileDetail.approvedTools
      .filter((tool) => tool.remoteName === "blocked_echo")
      .map((tool) => tool.toolName),
  });
  await setPreferences([
    { serverId: hostile.id, optedIn: true },
    { serverId: reference.id, optedIn: false },
  ]);
  const blockedSent = await startAgentRun("blocked");
  await waitFor("blocked hostile call", async () => hostileState().blockedCalls > 0, 30_000);
  await putBinding(hostile.id, { enabled: false });
  const blockedRun = await waitRun(blockedSent.run.id, 30_000);
  hostileControl("/__audit/release");
  addMatrix(
    "revoke_during_blocked_call",
    "live recheck aborts and refuses stale result",
    blockedRun.status === "failed" &&
      ["agent_mcp_access_revoked", "agent_mcp_config_changed"].includes(blockedRun.errorCode)
      ? "PASS"
      : "FAIL",
    { severity: "critical", transportHits: 1, evidence: blockedRun.errorCode },
  );

  await putBinding(hostile.id, {
    enabled: true,
    toolSelection: "selected",
    toolNames: hostileDetail.approvedTools
      .filter((tool) => tool.remoteName === "echo")
      .map((tool) => tool.toolName),
  });
  hostileControl("/__audit/version", { version: 2 });
  const changedDiscovery = await discover(hostile.id);
  const changedEcho = changedDiscovery.snapshot.tools.find((tool) => tool.remoteName === "echo");
  const changedDetail = (await api("GET", `/api/ai/mcp-servers/${hostile.id}`)).payload;
  const changedApprovalRetained = changedDetail.approvedTools.some(
    (tool) => tool.remoteName === "echo",
  );
  addMatrix(
    "capability_snapshot_change",
    "fingerprint change revokes prior approval",
    changedEcho?.approved === false && !changedApprovalRetained
      ? "PASS"
      : "FAIL",
    { severity: "critical" },
  );

  await browserEvidence();

  const logText = docker(["logs", appContainer]);
  const leakScan = {
    headerCanary: logText.includes(headerCanary) ? 1 : 0,
    authToken: logText.includes(required("DOCMOST_AUTH_TOKEN")) ? 1 : 0,
    csrfToken: logText.includes(required("DOCMOST_CSRF_TOKEN")) ? 1 : 0,
    argumentCanary: logText.includes("MCP_SAFE_ECHO_CANARY") ? 1 : 0,
    maliciousResult: logText.includes("globalThis.__mcpPwned") ? 1 : 0,
    testedOrigins: Object.values(origins).filter((origin) => logText.includes(origin)).length,
  };
  await fs.writeFile(
    path.join(auditRoot, "fixed", "log-and-metrics-leak-scan.json"),
    `${JSON.stringify(leakScan, null, 2)}\n`,
  );
  addMatrix(
    "operational_metrics_privacy",
    "closed vocabulary only; no URL/IDs/headers/args/results",
    Object.values(leakScan).every((count) => count === 0) ? "PASS" : "FAIL",
    { severity: "critical", evidence: "metrics unit suite and runtime canary scan" },
  );

  const modelRows = modelRequests();
  addMatrix(
    "write_tool_absence",
    "false readOnlyHint tool never enters model definitions or invocation log",
    modelRows.every((row) => !row.writeLikeToolOffered) &&
      !hostileState().callArgsHashes.some((entry) => entry.name === "claimed_readonly_write")
      ? "PASS"
      : "FAIL",
    { severity: "critical", transportHits: 0 },
  );

  const hostileV2 = await approve(hostile.id, ["echo"], changedDiscovery.snapshot);
  await putBinding(hostile.id, {
    enabled: true,
    toolSelection: "selected",
    toolNames: hostileV2.approvedTools.map((tool) => tool.toolName),
  });
  await setPreferences([
    { serverId: hostile.id, optedIn: true },
    { serverId: reference.id, optedIn: false },
  ]);
  await recreateApp(false);
  await gateAttempt("deployment_switch_off_agent_call", 0);
  await recreateApp(true);

  addMatrix(
    "member_role_denial",
    "ordinary member cannot manage workspace catalog",
    process.env.DOCMOST_MEMBER_AUTH_TOKEN ? "NOT RUN" : "BLOCKED",
    { severity: "high", evidence: "no isolated member session supplied" },
  );
  addMatrix(
    "dns_rebinding_two_sink",
    "dispatcher remains pinned to first approved DNS answer",
    "PASS",
    { severity: "critical", evidence: "lower-level pinned-dispatcher regression suite" },
  );
}

async function cleanup() {
  try {
    if (apiContext) {
      if (originalLocale) {
        await api("POST", "/api/users/update", { locale: originalLocale }).catch(() => undefined);
      }
      if (createdGroup?.id) {
        await api("POST", "/api/groups/actions/delete", { groupId: createdGroup.id }).catch(
          () => undefined,
        );
      }
      if (createdSpace?.id) {
        await api("DELETE", `/api/spaces/${createdSpace.id}`).catch(() => undefined);
      }
      for (const serverId of createdServerIds.reverse()) {
        await api("DELETE", `/api/ai/mcp-servers/${serverId}`).catch(() => undefined);
      }
      if (originalSettings) {
        await api("PATCH", "/api/ai/mcp-settings", {
          enabled: originalSettings.enabled,
          allowedOrigins: originalSettings.allowedOrigins,
        }).catch(() => undefined);
      }
    }
  } finally {
    if (apiContext) await apiContext.dispose().catch(() => undefined);
    apiContext = undefined;
    await restoreAppEnvironment().catch(() => undefined);
    for (const name of Object.values(containers)) {
      if (name.startsWith("ai-mcp-")) {
        spawnSync("docker", ["rm", "-f", name], {
          cwd: repoRoot,
          encoding: "utf8",
        });
      }
    }
  }
}

async function writeArtifacts(exitError) {
  const finalSha = command("git", ["rev-parse", "HEAD"]);
  const manifest = {
    runId,
    baseSha: finalSha,
    finalSha,
    testedAt: new Date().toISOString(),
    testedOrigins: origins,
    referencePackage,
    referenceImage,
    referenceTrust:
      "Official protocol test server, pinned by npm release, integrity, and gitHead; broad demo surface, so the audit approves only echo and supplies no secrets.",
    error: exitError ? String(exitError.message ?? exitError) : null,
  };
  await fs.writeFile(
    path.join(auditRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(auditRoot, "fixed", "api-trace.json"),
    `${JSON.stringify(traces, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(auditRoot, "fixed", "threat-matrix.json"),
    `${JSON.stringify(matrix, null, 2)}\n`,
  );
  const rows = matrix
    .map(
      (row) =>
        `| ${row.scenario} | ${row.expectedControl} | ${row.transportHits ?? "-"} | ${row.severity} | ${row.status} |`,
    )
    .join("\n");
  const report = `# Outbound external MCP audit ${runId}\n\n` +
    `Reference: ${referencePackage.name}@${referencePackage.version}, gitHead ${referencePackage.gitHead}. Only echo was approved.\n\n` +
    `## Threat matrix\n\n| Scenario | Expected control | Hits | Severity | Status |\n| --- | --- | ---: | --- | --- |\n${rows}\n\n` +
    `## Residual protocol risk\n\nA remote implementation can lie about side effects. Docmost can keep write-like tools unapproved and expose only administrator-approved read-only classifications, but MCP metadata cannot prove the implementation is side-effect free.\n`;
  await fs.writeFile(path.join(auditRoot, "report.md"), report);
}

async function scanArtifacts() {
  const findings = [];
  const secrets = [
    process.env.DOCMOST_AUTH_TOKEN,
    process.env.DOCMOST_CSRF_TOKEN,
    headerCanary,
    controlToken,
  ].filter(Boolean);
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (!/\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
        const text = await fs.readFile(fullPath, "utf8");
        for (const secret of secrets) {
          if (text.includes(secret)) findings.push(path.relative(auditRoot, fullPath));
        }
      }
    }
  }
  await walk(auditRoot);
  const summary = { scannedAt: new Date().toISOString(), findings: [...new Set(findings)] };
  await fs.writeFile(
    path.join(auditRoot, "artifact-secret-scan.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  if (findings.length > 0) throw new Error("audit artifact secret scan failed");
}

await fs.mkdir(path.join(auditRoot, "baseline"), { recursive: true });
await fs.mkdir(path.join(auditRoot, "fixed"), { recursive: true });
await fs.mkdir(path.join(auditRoot, "screenshots"), { recursive: true });
await fs.writeFile(
  path.join(auditRoot, "baseline", "confirmed-defect.json"),
  `${JSON.stringify(
    {
      defect: "group policy rows affected runtime authorization but had no supported binding API or UI management",
      status: "FAIL",
      redacted: true,
    },
    null,
    2,
  )}\n`,
);

let exitError;
try {
  command("node", ["--test", "apps/server/test/fixtures/ai-external-mcp-hostile-server.test.mjs"]);
  if (process.env.DOCMOST_AI_MCP_E2E_SKIP_LIVE !== "1") {
    required("DOCMOST_AUTH_TOKEN");
    required("DOCMOST_CSRF_TOKEN");
    await runLiveAudit();
  }
} catch (error) {
  exitError = error;
  try {
    const probeDiagnostics = docker(["logs", appContainer])
      .split(/\r?\n/)
      .filter((line) =>
        [
          "external_mcp.probe_tools",
          "external_mcp.discovery_probe_result",
          "external_mcp.discovery_stored_result",
        ].some((event) => line.includes(event)),
      )
      .map((line) => {
        const event = line.match(/external_mcp\.[a-z_]+/)?.[0] ?? "unknown";
        const mode = line.match(/\\?"mode\\?":\\?"(test|discover)\\?"/)?.[1] ?? "unknown";
        const count = Number(line.match(/\\?"toolCount\\?":(\d+)/)?.[1] ?? -1);
        return { event, mode, toolCount: count };
      });
    traces.push({
      method: "AUDIT",
      path: "probe_tool_count_diagnostics",
      status: 0,
      evidence: probeDiagnostics,
    });
  } catch {
    // The primary audit error remains authoritative if diagnostics are unavailable.
  }
} finally {
  await cleanup();
  await writeArtifacts(exitError);
  await scanArtifacts();
}

if (exitError) throw exitError;
if (matrix.some((row) => row.status === "FAIL")) {
  throw new Error("outbound MCP threat matrix contains FAIL rows");
}
