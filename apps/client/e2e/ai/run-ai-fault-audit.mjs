import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { request } from "@playwright/test";

const execFileAsync = promisify(execFile);
const clientRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(clientRoot, "../..");
const auditRoot = path.resolve(
  process.env.DOCMOST_AI_FAULT_AUDIT_ROOT ??
    path.join(repoRoot, "output/audit/g02-ai-assistant-2026-08-10/fault-final"),
);
const evidencePath = path.join(auditRoot, "fault-recovery.json");
const baseURL = (
  process.env.DOCMOST_BASE_URL ?? "http://localhost:3002"
).replace(/\/$/, "");
const origin = (process.env.DOCMOST_API_ORIGIN ?? baseURL).replace(/\/$/, "");
const appContainer =
  process.env.DOCMOST_CONTAINER_NAME ?? "docmost-g02-docmost-1";
const dbContainer = process.env.DOCMOST_DB_CONTAINER_NAME ?? "docmost-g02-db-1";
const redisContainer =
  process.env.DOCMOST_REDIS_CONTAINER_NAME ?? "docmost-g02-redis-1";
const mockPort = Number(process.env.DOCMOST_AI_MOCK_PORT ?? 1080);
const providerBaseUrl =
  process.env.DOCMOST_AI_PROVIDER_BASE_URL ??
  `http://host.docker.internal:${mockPort}/v1`;
const mockImage =
  "mockserver/mockserver@sha256:fed9b2089e021947f785d1f0bfda3723352bb2c1634ce7b0bcd42dfd1b0fd02f";
const runId = new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14);
const mockContainer = `docmost-ai-fault-${runId}`;
const canary = `audit-fault-canary-${randomBytes(24).toString("base64url")}`;
const adminEmail = required("DOCMOST_ADMIN_EMAIL");
const adminPassword = required("DOCMOST_ADMIN_PASSWORD");
const result = {
  runId,
  checkedAt: new Date().toISOString(),
  image: null,
  mock: {
    image: mockImage,
    tagCommit: "6fb02a58ba9f7c6648553aaf85625ff0344f1e53",
  },
  responseAbort: null,
  queuedRecovery: null,
  staleRunningRecovery: null,
  secretScan: null,
  retained: true,
};

let api;
let csrfToken;
let authToken;
let spaceId;
let mockStarted = false;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied at runtime`);
  return value;
}

function unwrap(payload) {
  return payload && typeof payload === "object" && "data" in payload
    ? payload.data
    : payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function docker(args, options = {}) {
  return execFileAsync("docker", args, {
    cwd: repoRoot,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

async function waitFor(check, description, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `${description} timed out${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

async function waitForContainerHealth(container) {
  return waitFor(
    async () => {
      const { stdout } = await docker([
        "inspect",
        "-f",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        container,
      ]);
      return stdout.trim() === "healthy";
    },
    `${container} health`,
    90_000,
  );
}

async function json(response, expectedStatus) {
  const text = await response.text();
  const expected = Array.isArray(expectedStatus)
    ? expectedStatus
    : [expectedStatus];
  assert(
    expected.includes(response.status()),
    `${new URL(response.url()).pathname} returned ${response.status()}: ${text.slice(0, 300)}`,
  );
  return text ? unwrap(JSON.parse(text)) : undefined;
}

async function mutation(method, url, data, expectedStatus) {
  const response = await api[method](url, {
    data,
    headers: { "x-csrf-token": csrfToken },
  });
  return json(response, expectedStatus);
}

async function createConversation(pageId, title) {
  return mutation(
    "post",
    "/api/ai/conversations",
    { pageId, title, clientRequestId: randomUUID() },
    [200, 201],
  );
}

async function send(conversation, content, clientRequestId = randomUUID()) {
  return mutation(
    "post",
    `/api/ai/conversations/${conversation.id}/messages`,
    {
      content,
      clientRequestId,
      contextRevision: conversation.contextRevision ?? 0,
    },
    202,
  );
}

async function getRun(runIdValue) {
  const response = await api.get(`/api/ai/runs/${runIdValue}`);
  return json(response, 200);
}

async function waitForRun(runIdValue, predicate, description, timeoutMs) {
  return waitFor(
    async () => {
      const run = await getRun(runIdValue);
      return predicate(run) ? run : undefined;
    },
    description,
    timeoutMs,
  );
}

async function psql(sql) {
  const { stdout } = await docker([
    "exec",
    "-i",
    dbContainer,
    "psql",
    "-U",
    "docmost",
    "-d",
    "docmost",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
  return stdout.trim();
}

async function queueAction(action, runIdValue = "") {
  const script = `
    const { Queue } = require("bullmq");
    const action = process.argv[1];
    const runId = process.argv[2];
    const queue = new Queue("{ai-chat-queue}", { connection: { host: "redis", port: 6379 } });
    (async () => {
      let value = true;
      if (action === "pause") await queue.pause();
      if (action === "unpause") await queue.resume();
      if (action === "remove") {
        const job = await queue.getJob("ai-run-" + runId);
        value = Boolean(job);
        if (job) await job.remove();
      }
      if (action === "exists") value = Boolean(await queue.getJob("ai-run-" + runId));
      if (action === "duplicate") {
        await queue.add("ai-chat-run", { runId }, { jobId: "fault-duplicate-" + Date.now(), attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
      }
      await queue.close();
      console.log(JSON.stringify({ value }));
    })().catch((error) => { console.error(error.message); process.exitCode = 1; });
  `;
  const { stdout } = await docker([
    "exec",
    appContainer,
    "node",
    "-e",
    script,
    action,
    runIdValue,
  ]);
  return JSON.parse(stdout.trim()).value;
}

async function waitForMock() {
  await waitFor(
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${mockPort}/mockserver/status`,
      ).catch(() => undefined);
      return response?.status >= 100;
    },
    "MockServer startup",
    20_000,
  );
}

async function verifyMockExactlyOnce(marker) {
  const response = await fetch(
    `http://127.0.0.1:${mockPort}/mockserver/verify`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        httpRequest: {
          method: "POST",
          path: "/v1/chat/completions",
          body: { type: "REGEX", regex: `.*${marker}.*` },
        },
        times: { atLeast: 1, atMost: 1 },
      }),
    },
  );
  return response.status === 202;
}

async function abortCommittedResponse(conversation, content, clientRequestId) {
  const body = JSON.stringify({
    content,
    clientRequestId,
    contextRevision: conversation.contextRevision ?? 0,
  });
  const url = new URL(baseURL);
  const port = Number(url.port || 80);
  const requestText = [
    `POST /api/ai/conversations/${conversation.id}/messages HTTP/1.1`,
    `Host: ${url.host}`,
    `Origin: ${origin}`,
    `Referer: ${origin}/`,
    `Authorization: Bearer ${authToken}`,
    `Cookie: authToken=${authToken}; csrfToken=${csrfToken}`,
    `x-csrf-token: ${csrfToken}`,
    "Content-Type: application/json",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Connection: close",
    "",
    body,
  ].join("\r\n");
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(
        new Error("Aborted-response request did not receive response bytes"),
      );
    }, 15_000);
    socket.on("connect", () => socket.write(requestText));
    socket.once("data", () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function scanQueueForCanary() {
  const lua = `
    local c='0'; local n=0
    repeat
      local r=redis.call('SCAN',c,'MATCH','bull:*','COUNT',200); c=r[1]
      for _,k in ipairs(r[2]) do
        if redis.call('TYPE',k).ok == 'hash' then
          local d=redis.call('HGET',k,'data')
          if d and string.find(d,ARGV[1],1,true) then n=n+1 end
        end
      end
    until c=='0'
    return n
  `;
  const { stdout } = await docker([
    "exec",
    redisContainer,
    "redis-cli",
    "EVAL",
    lua,
    "0",
    canary,
  ]);
  return Number(stdout.trim());
}

async function setup() {
  api = await request.newContext({
    baseURL,
    timeout: 30_000,
    extraHTTPHeaders: {
      Origin: origin,
      Referer: `${origin}/`,
      Accept: "application/json",
    },
  });
  const login = await api.post("/api/auth/login", {
    data: { email: adminEmail, password: adminPassword },
  });
  assert(login.ok(), `Fault audit login returned ${login.status()}`);
  const storage = await api.storageState();
  authToken = storage.cookies.find(
    (cookie) => cookie.name === "authToken",
  )?.value;
  csrfToken = storage.cookies.find(
    (cookie) => cookie.name === "csrfToken",
  )?.value;
  assert(
    authToken && csrfToken,
    "Fault audit login did not return auth cookies",
  );

  const { stdout: image } = await docker([
    "inspect",
    "-f",
    "{{.Config.Image}} {{.Image}}",
    appContainer,
  ]);
  result.image = image.trim();

  const expectations = JSON.parse(
    await fs.readFile(
      path.join(import.meta.dirname, "mockserver-expectations.json"),
      "utf8",
    ),
  );
  await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    mockContainer,
    "-e",
    "MOCKSERVER_LOG_LEVEL=WARN",
    "-p",
    `${mockPort}:1080`,
    mockImage,
  ]);
  mockStarted = true;
  await waitForMock();
  const initialized = await fetch(
    `http://127.0.0.1:${mockPort}/mockserver/expectation`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(expectations),
    },
  );
  assert(
    initialized.ok,
    `MockServer initialization returned ${initialized.status}`,
  );

  const space = await mutation(
    "post",
    "/api/spaces",
    {
      name: `AI fault ${runId}`,
      slug: `aifault${runId}`,
      description: "Synthetic isolated AI queue recovery audit.",
    },
    [200, 201],
  );
  spaceId = space.id;
  const page = await mutation(
    "post",
    "/api/pages",
    {
      spaceId,
      title: "AI fault document",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Fault audit" }],
          },
        ],
      },
      format: "json",
    },
    [200, 201],
  );
  await mutation(
    "patch",
    `/api/spaces/${spaceId}/ai/config`,
    {
      enabled: true,
      agentEnabled: false,
      provider: "openai-compatible",
      baseUrl: providerBaseUrl,
      chatModel: "docmost-audit-model",
      apiKey: canary,
      maxOutputTokens: 512,
      contextWindow: 8192,
      requestTimeoutMs: 15_000,
      reasoningEnabled: true,
      visionEnabled: true,
      dailyRequestLimitPerUser: 100,
      dailyTokenLimitPerSpace: 2_000_000,
    },
    200,
  );
  return page;
}

async function runResponseAbort(page) {
  const conversation = await createConversation(page.id, "Response abort");
  const clientRequestId = randomUUID();
  const marker = `AUDIT_RESPONSE_ABORT_${runId}`;
  await abortCommittedResponse(conversation, marker, clientRequestId);
  const replay = await send(conversation, marker, clientRequestId);
  const count = Number(
    await psql(
      `select count(*) from ai_runs where conversation_id='${conversation.id}' and client_request_id='${clientRequestId}';`,
    ),
  );
  assert(count === 1, `Response-abort replay persisted ${count} runs`);
  result.responseAbort = {
    replayStatus: 202,
    runId: replay.run.id,
    persistedRuns: count,
  };
}

async function runQueuedRecovery(page) {
  const conversation = await createConversation(page.id, "Queued recovery");
  const marker = `AUDIT_QUEUED_RESTART_${runId}`;
  await queueAction("pause");
  const sent = await send(conversation, marker);
  const queued = await waitForRun(
    sent.run.id,
    (run) => run.status === "queued",
    "queued run before lost delivery",
    10_000,
  );
  assert(
    await queueAction("remove", sent.run.id),
    "Queued Bull job was missing",
  );
  await psql(
    `update ai_runs set enqueued_at=null, updated_at=now() where id='${sent.run.id}' and status='queued';`,
  );

  await docker(["restart", redisContainer]);
  await waitForContainerHealth(redisContainer);
  await docker(["restart", appContainer]);
  await waitForContainerHealth(appContainer);
  const reconciledJob = await waitFor(
    () => queueAction("exists", sent.run.id),
    "reconciled Bull job",
    30_000,
  );
  await queueAction("unpause");
  const completed = await waitForRun(
    sent.run.id,
    (run) => run.status === "completed",
    "queued run completion after Redis/server restart",
    45_000,
  );
  assert(
    await verifyMockExactlyOnce(marker),
    "Queued recovery did not call the provider exactly once",
  );
  result.queuedRecovery = {
    runId: sent.run.id,
    initialStatus: queued.status,
    reconciledJob: Boolean(reconciledJob),
    finalStatus: completed.status,
    finalSequence: completed.sequence,
    providerCalls: 1,
  };
}

async function runStaleRecovery(page) {
  const conversation = await createConversation(
    page.id,
    "Stale running recovery",
  );
  const marker = `AUDIT_DELAY_RUNNING_RESTART_${runId}`;
  const sent = await send(conversation, marker);
  const running = await waitForRun(
    sent.run.id,
    (run) => run.status === "running",
    "running provider call",
    15_000,
  );
  await waitFor(
    () => verifyMockExactlyOnce(marker),
    "initial provider request",
    15_000,
  );

  await docker(["stop", "-t", "0", appContainer]);
  await psql(
    `update ai_runs set heartbeat_at=now()-interval '13 minutes', updated_at=now() where id='${sent.run.id}' and status='running';`,
  );
  await docker(["start", appContainer]);
  await waitForContainerHealth(appContainer);
  const failed = await waitForRun(
    sent.run.id,
    (run) => run.status === "failed" && run.errorCode === "worker_lost",
    "stale running reconciliation",
    45_000,
  );
  assert(
    failed.sequence > running.sequence,
    "Run sequence did not increase when stale running state became terminal",
  );
  await sleep(35_000);
  assert(
    await verifyMockExactlyOnce(marker),
    "Stale running reconciliation repeated the provider request",
  );

  await queueAction("duplicate", sent.run.id);
  await sleep(5_000);
  const afterDuplicate = await getRun(sent.run.id);
  assert(
    afterDuplicate.status === "failed" &&
      afterDuplicate.sequence === failed.sequence,
    "Duplicate Bull delivery reopened or mutated a terminal run",
  );
  assert(
    await verifyMockExactlyOnce(marker),
    "Duplicate Bull delivery repeated the provider request",
  );

  const releasedConversation = await createConversation(
    page.id,
    "Released after failure",
  );
  const released = await send(
    releasedConversation,
    `AUDIT_NORMAL_AFTER_WORKER_LOST_${runId}`,
  );
  const releasedTerminal = await waitForRun(
    released.run.id,
    (run) => run.status === "completed",
    "slot release after worker_lost",
    30_000,
  );
  result.staleRunningRecovery = {
    runId: sent.run.id,
    runningSequence: running.sequence,
    finalStatus: failed.status,
    errorCode: failed.errorCode,
    finalSequence: failed.sequence,
    duplicateDeliveryStatus: afterDuplicate.status,
    duplicateDeliverySequence: afterDuplicate.sequence,
    providerCallsAfterStallWindow: 1,
    releasedRunStatus: releasedTerminal.status,
  };
}

async function scanSecrets() {
  const configResponse = await api.get(`/api/spaces/${spaceId}/ai/config`);
  const configText = await configResponse.text();
  assert(
    configResponse.ok(),
    "Public AI config could not be read for secret scan",
  );
  const apiOccurrences = configText.split(canary).length - 1;
  const dbOccurrences = Number(
    await psql(
      `select count(*) from ai_space_configs c where c.space_id='${spaceId}' and to_jsonb(c)::text like '%${canary}%';`,
    ),
  );
  const queueOccurrences = await scanQueueForCanary();
  const { stdout: appLogs = "", stderr: appLogErrors = "" } = await docker([
    "logs",
    appContainer,
  ]).catch(() => ({ stdout: "", stderr: "" }));
  const { stdout: mockLogs = "", stderr: mockLogErrors = "" } = await docker([
    "logs",
    mockContainer,
  ]).catch(() => ({ stdout: "", stderr: "" }));
  const count = (text, value) => text.split(value).length - 1;
  result.secretScan = {
    apiOccurrences,
    dbPlaintextOccurrences: dbOccurrences,
    queuePayloadOccurrences: queueOccurrences,
    appLogCanaryOccurrences: count(`${appLogs}${appLogErrors}`, canary),
    appLogAuthTokenOccurrences: count(`${appLogs}${appLogErrors}`, authToken),
    appLogCsrfTokenOccurrences: count(`${appLogs}${appLogErrors}`, csrfToken),
    mockLogCanaryOccurrences: count(`${mockLogs}${mockLogErrors}`, canary),
  };
  assert(
    Object.values(result.secretScan).every((value) => value === 0),
    "Fault audit found a plaintext secret outside the provider request boundary",
  );
}

await fs.rm(auditRoot, { recursive: true, force: true });
await fs.mkdir(auditRoot, { recursive: true });

try {
  const page = await setup();
  await runResponseAbort(page);
  await runQueuedRecovery(page);
  await runStaleRecovery(page);
  await scanSecrets();
  await mutation("delete", `/api/spaces/${spaceId}`, undefined, 200);
  spaceId = undefined;
  result.retained = false;
  result.completedAt = new Date().toISOString();
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  result.failedAt = new Date().toISOString();
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally {
  await docker(["start", redisContainer]).catch(() => undefined);
  await waitForContainerHealth(redisContainer).catch(() => undefined);
  await docker(["start", appContainer]).catch(() => undefined);
  await waitForContainerHealth(appContainer).catch(() => undefined);
  await queueAction("unpause").catch(() => undefined);
  if (spaceId && api && csrfToken) {
    await mutation("delete", `/api/spaces/${spaceId}`, undefined, 200).catch(
      () => undefined,
    );
  }
  if (api) await api.dispose();
  if (mockStarted) {
    await docker(["rm", "-f", mockContainer]).catch(() => undefined);
  }
}
