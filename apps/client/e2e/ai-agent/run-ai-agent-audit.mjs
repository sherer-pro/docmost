import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { request } from "@playwright/test";

const clientRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(clientRoot, "../..");
const dateRoot = path.join(repoRoot, "output/audit/ai-agent-mode-2026-08-09");
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`;
const auditRoot = path.join(dateRoot, runId);
const composeProject = `docmost-ai-agent-${runId.toLowerCase()}`;
const composeFiles = [
  path.join(repoRoot, "docker-compose.yml"),
  path.join(import.meta.dirname, "docker-compose.audit.yml"),
];
const toxiproxyImage = "ghcr.io/shopify/toxiproxy:2.12.0@sha256:9378ed52a28bc50edc1350f936f518f31fa95f0d15917d6eb40b8e376d1a214e";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function reservePort(preferred) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", preferred ? () => reservePort(0).then(resolve, reject) : reject);
    server.listen(preferred, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function composeArgs(...args) {
  return [
    "compose",
    "-p",
    composeProject,
    ...composeFiles.flatMap((file) => ["-f", file]),
    ...args,
  ];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    shell: options.shell ?? false,
    timeout: options.timeout ?? 20 * 60_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}: ${(result.stderr || result.stdout).slice(-4000)}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function waitFor(description, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${description} timed out${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

async function configureProxy(toxiproxyUrl, proxy) {
  const response = await fetch(`${toxiproxyUrl}/proxies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proxy),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`Toxiproxy proxy ${proxy.name} returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
}

async function setupAdmin(baseURL, email, password) {
  const context = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL, Referer: `${baseURL}/` },
  });
  try {
    const response = await context.post("/api/auth/setup", {
      data: {
        name: "AI Agent Audit Admin",
        email,
        password,
        workspaceName: "AI Agent Audit Workspace",
      },
    });
    const text = await response.text();
    assert(response.ok(), `Admin setup returned ${response.status()}: ${text.slice(0, 500)}`);
    const storage = await context.storageState();
    const authToken = storage.cookies.find((cookie) => cookie.name === "authToken")?.value;
    const csrfToken = storage.cookies.find((cookie) => cookie.name === "csrfToken")?.value;
    assert(authToken && csrfToken, "Admin setup did not issue authentication cookies");
    return { authToken, csrfToken };
  } finally {
    await context.dispose();
  }
}

async function listFiles(root) {
  const result = [];
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) result.push(full);
    }
  }
  await visit(root);
  return result;
}

async function scanArtifacts(root, exactSecrets) {
  const findings = [];
  const jwtPattern = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
  const cookiePattern = /(?:authToken|csrfToken)=[A-Za-z0-9._-]{16,}/gi;
  for (const file of await listFiles(root)) {
    const bytes = await fs.readFile(file);
    const text = bytes.toString("utf8");
    for (const [label, secret] of exactSecrets) {
      if (secret && bytes.includes(Buffer.from(secret))) findings.push({ file: path.relative(root, file), kind: label });
    }
    if (jwtPattern.test(text)) findings.push({ file: path.relative(root, file), kind: "jwt-pattern" });
    jwtPattern.lastIndex = 0;
    if (cookiePattern.test(text)) findings.push({ file: path.relative(root, file), kind: "cookie-pattern" });
    cookiePattern.lastIndex = 0;
  }
  await fs.writeFile(path.join(root, "secret-scan.json"), `${JSON.stringify({ ok: findings.length === 0, findings }, null, 2)}\n`);
  if (findings.length > 0) throw new Error(`Audit artifacts contain ${findings.length} secret-pattern finding(s)`);
}

await fs.mkdir(auditRoot, { recursive: true });
const appPort = Number(process.env.DOCMOST_AI_AGENT_APP_PORT ?? await reservePort(0));
const collabPort = Number(process.env.DOCMOST_AI_AGENT_COLLAB_PORT ?? await reservePort(0));
const modelPort = Number(process.env.DOCMOST_AI_AGENT_MODEL_PORT ?? await reservePort(0));
const toxiproxyPort = Number(process.env.DOCMOST_AI_AGENT_TOXIPROXY_PORT ?? await reservePort(0));
for (const [name, port] of [["app", appPort], ["collab", collabPort], ["model", modelPort], ["toxiproxy", toxiproxyPort]]) {
  assert(Number.isInteger(port) && port > 0 && port <= 65535, `${name} port is invalid`);
}

const baseURL = `http://127.0.0.1:${appPort}`;
const collabURL = `http://127.0.0.1:${collabPort}`;
const modelControlUrl = `http://127.0.0.1:${modelPort}`;
const modelProviderUrl = `http://host.docker.internal:${modelPort}/v1`;
const toxiproxyUrl = `http://127.0.0.1:${toxiproxyPort}`;
const appSecret = randomBytes(48).toString("base64url");
const databasePassword = randomBytes(30).toString("base64url");
const adminPassword = `Aa1!${randomBytes(30).toString("base64url")}`;
const adminEmail = `ai-agent-admin-${runId}@example.com`;
const canary = `audit-canary-${randomBytes(24).toString("base64url")}`;
const composeEnv = {
  ...process.env,
  COMPOSE_PROJECT_NAME: composeProject,
  PORT: String(appPort),
  APP_URL: baseURL,
  COLLAB_PORT: String(collabPort),
  COLLAB_URL: collabURL,
  APP_SECRET: appSecret,
  POSTGRES_USER: "docmost",
  POSTGRES_DB: "docmost",
  POSTGRES_PASSWORD: databasePassword,
  DATABASE_URL: `postgresql://docmost:${databasePassword}@toxiproxy:15432/docmost`,
  REDIS_URL: "redis://toxiproxy:16379",
  EDGE_NETWORK_NAME: `${composeProject}_edge`,
  EDGE_NETWORK_EXTERNAL: "false",
  DOCMOST_AI_AGENT_MODEL_PORT: String(modelPort),
  DOCMOST_AI_AGENT_TOXIPROXY_PORT: String(toxiproxyPort),
  AI_PROVIDER_ALLOWED_ORIGINS: `http://host.docker.internal:${modelPort}`,
};

const model = spawn(process.execPath, [path.join(import.meta.dirname, "deterministic-agent-model.mjs")], {
  cwd: clientRoot,
  env: { ...process.env, DOCMOST_AI_AGENT_MODEL_PORT: String(modelPort) },
  stdio: ["ignore", "pipe", "pipe"],
});
let modelStdout = "";
let modelStderr = "";
model.stdout.on("data", (chunk) => { modelStdout += chunk.toString("utf8"); });
model.stderr.on("data", (chunk) => { modelStderr += chunk.toString("utf8"); });

let success = false;
let authToken = "";
let csrfToken = "";
const startedAt = new Date().toISOString();
try {
  await waitFor("deterministic Agent provider", async () => {
    if (model.exitCode !== null || model.signalCode !== null) {
      throw new Error(`provider exited before health check: ${modelStderr.slice(-500)}`);
    }
    return fetch(`${modelControlUrl}/health`).then((response) => response.ok).catch(() => false);
  }, 15_000);
  if (process.env.DOCMOST_AI_AGENT_SKIP_BUILD !== "1") {
    const build = run("docker", composeArgs("build", "docmost"), { env: composeEnv, timeout: 30 * 60_000 });
    await fs.writeFile(path.join(auditRoot, "container-build.log"), `${build.stdout.slice(-20_000)}${build.stderr.slice(-20_000)}`);
  }
  run("docker", composeArgs("up", "-d", "db", "redis", "toxiproxy"), { env: composeEnv });
  await waitFor("isolated PostgreSQL", () => {
    const check = spawnSync("docker", composeArgs("exec", "-T", "db", "pg_isready", "-U", "docmost", "-d", "docmost"), {
      cwd: repoRoot,
      env: composeEnv,
      encoding: "utf8",
      timeout: 10_000,
    });
    return check.status === 0;
  }, 60_000);
  await waitFor("Toxiproxy", () => fetch(`${toxiproxyUrl}/version`).then((response) => response.ok).catch(() => false), 60_000);
  await configureProxy(toxiproxyUrl, { name: "postgres", listen: "0.0.0.0:15432", upstream: "db:5432", enabled: true });
  await configureProxy(toxiproxyUrl, { name: "redis", listen: "0.0.0.0:16379", upstream: "redis:6379", enabled: true });
  run("docker", composeArgs(
    "run",
    "--rm",
    "--no-deps",
    "docmost",
    "node",
    "apps/server/dist/apps/server/src/database/migrate.js",
    "latest",
  ), { env: composeEnv, timeout: 5 * 60_000 });
  run("docker", composeArgs("up", "-d", "docmost", "collab"), { env: composeEnv, timeout: 5 * 60_000 });
  await waitFor("isolated Docmost", () => fetch(`${baseURL}/api/health`).then((response) => response.ok).catch(() => false), 4 * 60_000);
  await waitFor("isolated collaboration server", () => fetch(`${collabURL}/api/health`).then((response) => response.ok).catch(() => false), 4 * 60_000);

  ({ authToken, csrfToken } = await setupAdmin(baseURL, adminEmail, adminPassword));
  const playwrightEnv = {
    ...composeEnv,
    DOCMOST_BASE_URL: baseURL,
    DOCMOST_AUTH_TOKEN: authToken,
    DOCMOST_CSRF_TOKEN: csrfToken,
    DOCMOST_AI_AGENT_RUN_ID: runId,
    DOCMOST_AI_AGENT_AUDIT_ROOT: auditRoot,
    DOCMOST_AI_AGENT_MODEL_CONTROL_URL: modelControlUrl,
    DOCMOST_AI_AGENT_MODEL_PROVIDER_URL: modelProviderUrl,
    DOCMOST_AI_AGENT_TOXIPROXY_URL: toxiproxyUrl,
    DOCMOST_AI_AGENT_COMPOSE_PROJECT: composeProject,
    DOCMOST_AI_AGENT_CANARY: canary,
  };
  const testRun = run("corepack", [
    "pnpm",
    "--filter",
    "./apps/client",
    "exec",
    "playwright",
    "test",
    "--config",
    "playwright.ai-agent.config.ts",
  ], {
    env: playwrightEnv,
    timeout: 15 * 60_000,
    shell: process.platform === "win32",
  });
  await fs.writeFile(path.join(auditRoot, "playwright-console.log"), `${testRun.stdout}${testRun.stderr}`);

  const providerLog = await fetch(`${modelControlUrl}/__requests`).then((response) => response.json());
  await fs.writeFile(path.join(auditRoot, "provider-metadata.json"), `${JSON.stringify(providerLog, null, 2)}\n`);
  const toxiproxyState = await fetch(`${toxiproxyUrl}/proxies`).then((response) => response.json());
  await fs.writeFile(path.join(auditRoot, "toxiproxy-final-state.json"), `${JSON.stringify(toxiproxyState, null, 2)}\n`);
  const provenance = run("docker", ["image", "inspect", "docmost-local:dev", toxiproxyImage, "--format", "{{json .}}"], { env: composeEnv }).stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const image = JSON.parse(line);
      return { id: image.Id, repoDigests: image.RepoDigests ?? [], created: image.Created, labels: image.Config?.Labels ?? {} };
    });
  await fs.writeFile(path.join(auditRoot, "container-provenance.json"), `${JSON.stringify({ requestedToxiproxyImage: toxiproxyImage, images: provenance }, null, 2)}\n`);
  await fs.writeFile(path.join(auditRoot, "runner-summary.json"), `${JSON.stringify({
    runId,
    composeProject,
    startedAt,
    completedAt: new Date().toISOString(),
    baseURL,
    status: "passed",
    cleanup: "pending",
  }, null, 2)}\n`);
  await scanArtifacts(auditRoot, [
    ["auth-token", authToken],
    ["csrf-token", csrfToken],
    ["app-secret", appSecret],
    ["database-password", databasePassword],
    ["admin-password", adminPassword],
    ["canary", canary],
  ]);
  success = true;
} catch (error) {
  const runtimeLogs = spawnSync("docker", composeArgs("logs", "--no-color", "--tail", "1000"), {
    cwd: repoRoot,
    env: composeEnv,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  await fs.writeFile(
    path.join(auditRoot, "container-runtime.log"),
    `${runtimeLogs.stdout ?? ""}${runtimeLogs.stderr ?? ""}`,
  );
  await fetch(`${modelControlUrl}/__requests`)
    .then((response) => response.json())
    .then((payload) => fs.writeFile(
      path.join(auditRoot, "provider-metadata.failure.json"),
      `${JSON.stringify(payload, null, 2)}\n`,
    ))
    .catch(() => undefined);
  const failure = {
    runId,
    composeProject,
    startedAt,
    failedAt: new Date().toISOString(),
    baseURL,
    ports: { app: appPort, collab: collabPort, model: modelPort, toxiproxy: toxiproxyPort },
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    retainedVolumes: true,
  };
  await fs.writeFile(path.join(auditRoot, "failure-state.json"), `${JSON.stringify(failure, null, 2)}\n`);
  throw error;
} finally {
  if (model.exitCode === null && model.signalCode === null) {
    model.kill("SIGTERM");
    await new Promise((resolve) => model.once("exit", resolve));
  }
  if (modelStdout.trim()) await fs.writeFile(path.join(auditRoot, "deterministic-provider.stdout.log"), modelStdout.slice(-10_000));
  if (modelStderr.trim()) await fs.writeFile(path.join(auditRoot, "deterministic-provider.stderr.log"), modelStderr.slice(-10_000));
  const downArgs = composeArgs("down", "--remove-orphans", ...(success ? ["-v"] : []));
  const down = spawnSync("docker", downArgs, { cwd: repoRoot, env: composeEnv, encoding: "utf8", timeout: 5 * 60_000 });
  await fs.writeFile(path.join(auditRoot, "cleanup.log"), `${down.stdout ?? ""}${down.stderr ?? ""}`);
  if (success) {
    const summaryPath = path.join(auditRoot, "runner-summary.json");
    const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
    summary.cleanup = down.status === 0 ? "volumes-removed" : "cleanup-failed";
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    assert(down.status === 0, "Isolated Compose cleanup failed");
  }
}

process.stdout.write(`AI Agent mode audit passed: ${runId}\n`);
