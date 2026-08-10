import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { request } from "@playwright/test";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const clientRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(clientRoot, "../..");
const auditRoot = path.resolve(
  process.env.DOCMOST_AI_AUDIT_ROOT ??
    path.join(repoRoot, "output/audit/ai-assistant-2026-08-07"),
);
const statePath = path.join(auditRoot, "audit-state.json");
const baseURL = (
  process.env.DOCMOST_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
const apiBaseURL = (process.env.DOCMOST_API_BASE_URL ?? baseURL).replace(
  /\/$/,
  "",
);
const apiOrigin = (process.env.DOCMOST_API_ORIGIN ?? baseURL).replace(
  /\/$/,
  "",
);
const mockImage =
  "mockserver/mockserver@sha256:fed9b2089e021947f785d1f0bfda3723352bb2c1634ce7b0bcd42dfd1b0fd02f";
const mockPort = Number(process.env.DOCMOST_AI_MOCK_PORT ?? 1080);
const providerBaseUrl =
  process.env.DOCMOST_AI_PROVIDER_BASE_URL ?? `http://127.0.0.1:${mockPort}/v1`;
const runId = new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14);
const containerName = `docmost-ai-audit-${runId}`;
const canary = `audit-canary-${randomBytes(24).toString("base64url")}`;
process.env.DOCMOST_AUDIT_CANARY = canary;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied at runtime`);
  return value;
}

function unwrap(payload) {
  return payload &&
    typeof payload === "object" &&
    "success" in payload &&
    "data" in payload
    ? payload.data
    : payload;
}

async function responseJson(response) {
  const text = await response.text();
  if (!response.ok())
    throw new Error(
      `${new URL(response.url()).pathname} failed with ${response.status()}: ${text.slice(0, 500)}`,
    );
  return text ? unwrap(JSON.parse(text)) : undefined;
}

async function createApi() {
  const csrfToken = required("DOCMOST_CSRF_TOKEN");
  const authToken = required("DOCMOST_AUTH_TOKEN");
  return request.newContext({
    baseURL: apiBaseURL,
    timeout: 30_000,
    extraHTTPHeaders: {
      Authorization: `Bearer ${authToken}`,
      Cookie: `csrfToken=${csrfToken}`,
      Origin: apiOrigin,
      Referer: `${apiOrigin}/`,
      "x-csrf-token": csrfToken,
      Accept: "application/json",
    },
  });
}

async function provisionAuditMember(api, spaceId, index) {
  const email = `g02-member-${index}-${runId}@audit.invalid`;
  const password = `G02-Member-${index}-${runId}!`;
  await responseJson(
    await api.post("/api/workspace/invites/create", {
      data: { emails: [email], groupIds: [], role: "member" },
    }),
  );
  const invitations = await responseJson(
    await api.get("/api/workspace/invites", {
      params: { query: email, limit: 50 },
    }),
  );
  const invitation = invitations?.items?.find((item) => item.email === email);
  if (!invitation?.id) {
    throw new Error("Synthetic audit member invitation was not persisted");
  }
  const link = await responseJson(
    await api.post("/api/workspace/invites/link", {
      data: { invitationId: invitation.id },
    }),
  );
  const inviteUrl = new URL(link.inviteLink);
  const token = inviteUrl.searchParams.get("token");
  if (!token) {
    throw new Error("Synthetic audit member invitation link had no token");
  }
  const memberContext = await request.newContext({
    baseURL: apiBaseURL,
    timeout: 30_000,
    extraHTTPHeaders: { Origin: apiOrigin, Referer: `${apiOrigin}/` },
  });
  try {
    await responseJson(
      await memberContext.post("/api/workspace/invites/accept", {
        data: {
          invitationId: invitation.id,
          token,
          name: "G02 Member",
          password,
        },
      }),
    );
    const storage = await memberContext.storageState();
    const authToken = storage.cookies.find(
      (cookie) => cookie.name === "authToken",
    )?.value;
    const csrfToken = storage.cookies.find(
      (cookie) => cookie.name === "csrfToken",
    )?.value;
    if (!authToken || !csrfToken) {
      throw new Error("Synthetic audit member did not receive auth cookies");
    }
    const currentUser = await responseJson(
      await memberContext.get("/api/users/me"),
    );
    const memberId = currentUser?.user?.id;
    if (!memberId) {
      throw new Error("Synthetic audit member identity was not returned");
    }
    await responseJson(
      await api.post("/api/spaces/members/add", {
        data: {
          spaceId,
          role: "writer",
          userIds: [memberId],
          groupIds: [],
        },
      }),
    );
    return { email, id: memberId, authToken, csrfToken };
  } finally {
    await memberContext.dispose();
  }
}

async function ensureRuntimeAuth() {
  if (
    process.env.DOCMOST_AUTH_TOKEN?.trim() &&
    process.env.DOCMOST_CSRF_TOKEN?.trim()
  )
    return;
  const email = required("DOCMOST_ADMIN_EMAIL");
  const password = required("DOCMOST_ADMIN_PASSWORD");
  const loginContext = await request.newContext({
    baseURL: apiBaseURL,
    extraHTTPHeaders: { Origin: apiOrigin, Referer: `${apiOrigin}/` },
  });
  try {
    let response = await loginContext.post("/api/auth/login", {
      data: { email, password },
    });
    if (!response.ok()) {
      response = await loginContext.post("/api/auth/setup", {
        data: {
          name: "G02 Audit Owner",
          email,
          password,
          workspaceName: "G02 Audit Workspace",
        },
      });
    }
    if (!response.ok()) {
      throw new Error(
        `Audit admin login/setup failed with ${response.status()}`,
      );
    }
    const storage = await loginContext.storageState();
    const authToken = storage.cookies.find(
      (cookie) => cookie.name === "authToken",
    )?.value;
    const csrfToken = storage.cookies.find(
      (cookie) => cookie.name === "csrfToken",
    )?.value;
    if (!authToken || !csrfToken)
      throw new Error("Audit admin login did not return the required cookies");
    process.env.DOCMOST_AUTH_TOKEN = authToken;
    process.env.DOCMOST_CSRF_TOKEN = csrfToken;
  } finally {
    await loginContext.dispose();
  }
}

async function waitForMock() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${mockPort}/mockserver/status`,
      );
      if (response.status >= 100) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Pinned MockServer did not become ready");
}

async function runNode(script, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: clientRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function runPlaywright() {
  const cli = require.resolve("@playwright/test/cli");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, "test", "--config=playwright.ai.config.ts"],
      {
        cwd: clientRoot,
        env: process.env,
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

await fs.rm(auditRoot, { recursive: true, force: true });
for (const directory of [
  "console-errors",
  "network",
  "playwright-artifacts",
  "playwright-html",
  "screenshots",
  "traces",
]) {
  await fs.mkdir(path.join(auditRoot, directory), { recursive: true });
}

let api;
let spaceId;
let exitCode = 1;
let mockStarted = false;
try {
  await ensureRuntimeAuth();
  await execFileAsync("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-p",
    `${mockPort}:1080`,
    mockImage,
  ]);
  mockStarted = true;
  await waitForMock();
  const expectations = JSON.parse(
    await fs.readFile(
      path.join(import.meta.dirname, "mockserver-expectations.json"),
      "utf8",
    ),
  );
  const initialized = await fetch(
    `http://127.0.0.1:${mockPort}/mockserver/expectation`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(expectations),
    },
  );
  if (!initialized.ok)
    throw new Error(
      `MockServer expectation initialization failed with ${initialized.status}`,
    );

  api = await createApi();
  const space = await responseJson(
    await api.post("/api/spaces", {
      data: {
        name: `AI audit ${runId}`,
        slug: `aiaudit${runId}`,
        description: "Isolated deterministic AI assistant audit space.",
      },
    }),
  );
  spaceId = space.id;
  const page = await responseJson(
    await api.post("/api/pages", {
      data: {
        spaceId,
        title: "AI audit document",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "AI audit context" }],
            },
          ],
        },
        format: "json",
      },
    }),
  );
  await responseJson(
    await api.patch(`/api/spaces/${spaceId}/ai/config`, {
      data: {
        enabled: true,
        agentEnabled: false,
        provider: "openai-compatible",
        baseUrl: providerBaseUrl,
        chatModel: "docmost-audit-model",
        apiKey: canary,
        temperature: 0,
        maxOutputTokens: 512,
        contextWindow: 8192,
        requestTimeoutMs: 15000,
        reasoningEnabled: true,
        visionEnabled: true,
        quickCommands: [
          {
            id: "audit-summary",
            label: "Audit summary",
            prompt: "Summarize this document",
            enabled: true,
            position: 0,
          },
        ],
      },
    }),
  );
  const members = [];
  for (let index = 1; index <= 5; index += 1) {
    members.push(await provisionAuditMember(api, spaceId, index));
  }
  const [member] = members;
  process.env.DOCMOST_MEMBER_AUTH_TOKEN = member.authToken;
  process.env.DOCMOST_MEMBER_CSRF_TOKEN = member.csrfToken;
  process.env.DOCMOST_CONCURRENCY_IDENTITIES = JSON.stringify(
    members.map(({ id, authToken, csrfToken }) => ({
      id,
      authToken,
      csrfToken,
    })),
  );
  process.env.DOCMOST_AUDIT_EXTRA_SECRETS = members
    .flatMap(({ authToken, csrfToken }) => [authToken, csrfToken])
    .join(",");
  await fs.writeFile(
    statePath,
    `${JSON.stringify({ runId, spaceId, spaceSlug: space.slug, pageId: page.id, pageSlugId: page.slugId, pageTitle: page.title, memberEmail: member.email, memberId: member.id, memberIds: members.map(({ id }) => id), retained: true, mock: { image: mockImage, tagCommit: "6fb02a58ba9f7c6648553aaf85625ff0344f1e53" } }, null, 2)}\n`,
  );

  exitCode = await runPlaywright();
  const scannerEnv = { ...process.env, DOCMOST_AUDIT_CANARY: canary };
  scannerEnv.DOCMOST_AI_AUDIT_ROOT = auditRoot;
  const sanitizerCode = await runNode(
    path.join(import.meta.dirname, "sanitize-traces.mjs"),
    scannerEnv,
  );
  if (sanitizerCode !== 0) exitCode = sanitizerCode;
  const scannerCode = await runNode(
    path.join(import.meta.dirname, "scan-artifacts.mjs"),
    scannerEnv,
  );
  if (scannerCode !== 0) exitCode = scannerCode;
  if (exitCode === 0) {
    await responseJson(await api.delete(`/api/spaces/${spaceId}`));
    spaceId = undefined;
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    state.retained = false;
    state.deletedAt = new Date().toISOString();
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
} finally {
  if (api) await api.dispose();
  const appContainer =
    process.env.DOCMOST_CONTAINER_NAME ??
    (
      await execFileAsync("docker", ["compose", "ps", "-q", "docmost"], {
        cwd: repoRoot,
      }).catch(() => ({ stdout: "" }))
    ).stdout.trim();
  const appLogs = await execFileAsync("docker", ["logs", appContainer], {
    maxBuffer: 20 * 1024 * 1024,
  }).catch((error) => ({
    stdout: "",
    stderr: "",
    error: error instanceof Error ? error.message : String(error),
  }));
  const appLogText = `${appLogs.stdout ?? ""}${appLogs.stderr ?? ""}`;
  const count = (value) =>
    value && appLogText.includes(value)
      ? appLogText.split(value).length - 1
      : 0;
  await fs.writeFile(
    path.join(auditRoot, "application-log-secret-scan.json"),
    `${JSON.stringify(
      {
        scannedAt: new Date().toISOString(),
        container: appContainer,
        bytesScanned: Buffer.byteLength(appLogText),
        canaryOccurrences: count(canary),
        authTokenOccurrences: count(process.env.DOCMOST_AUTH_TOKEN),
        csrfTokenOccurrences: count(process.env.DOCMOST_CSRF_TOKEN),
        extraSecretOccurrences: (process.env.DOCMOST_AUDIT_EXTRA_SECRETS ?? "")
          .split(",")
          .filter(Boolean)
          .reduce((sum, secret) => sum + count(secret), 0),
        error: appLogs.error ?? null,
      },
      null,
      2,
    )}\n`,
  );
  if (
    count(canary) > 0 ||
    count(process.env.DOCMOST_AUTH_TOKEN) > 0 ||
    count(process.env.DOCMOST_CSRF_TOKEN) > 0 ||
    (process.env.DOCMOST_AUDIT_EXTRA_SECRETS ?? "")
      .split(",")
      .filter(Boolean)
      .some((secret) => count(secret) > 0)
  ) {
    exitCode = 1;
  }
  if (mockStarted) {
    const logs = await execFileAsync("docker", ["logs", containerName], {
      maxBuffer: 10 * 1024 * 1024,
    }).catch(() => ({ stdout: "", stderr: "" }));
    const safeLogs = `${logs.stdout ?? ""}${logs.stderr ?? ""}`
      .replaceAll(canary, "[redacted-canary]")
      .replaceAll(process.env.DOCMOST_AUTH_TOKEN ?? "", "[redacted-auth]")
      .replaceAll(process.env.DOCMOST_CSRF_TOKEN ?? "", "[redacted-csrf]");
    await fs.writeFile(path.join(auditRoot, "mockserver.log"), safeLogs);
    await execFileAsync("docker", ["rm", "-f", containerName]).catch(
      () => undefined,
    );
  }
  if (spaceId) {
    const state = JSON.parse(
      await fs.readFile(statePath, "utf8").catch(() => "{}"),
    );
    state.retained = true;
    state.retainedReason = "test-failure";
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
}

process.exitCode = exitCode;
