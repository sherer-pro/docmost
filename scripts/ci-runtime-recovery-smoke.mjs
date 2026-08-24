import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const requireFromClient = createRequire(
  new URL("../apps/client/package.json", import.meta.url),
);
const { io } = requireFromClient("socket.io-client");

const baseUrl = new URL(
  process.env.CI_SMOKE_BASE_URL ?? "http://127.0.0.1:3000",
);
const collabUrl = new URL(
  process.env.CI_SMOKE_COLLAB_URL ?? "http://127.0.0.1:3001",
);
const adminEmail = process.env.DOCMOST_ADMIN_EMAIL;
const adminPassword = process.env.DOCMOST_ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) {
  throw new Error("Runtime recovery smoke requires admin credentials");
}

function fail(message) {
  throw new Error(`Runtime recovery smoke failed: ${message}`);
}

async function docker(...args) {
  const result = await execFile("docker", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

async function inspectContainer(name) {
  const payload = await docker("inspect", name);
  const [inspection] = JSON.parse(payload);
  return {
    id: inspection.Id,
    restartCount: inspection.RestartCount,
    status: inspection.State.Status,
  };
}

function collectCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const fallback = response.headers.get("set-cookie");
  const raw =
    values.length > 0 ? values : fallback ? fallback.split(/,(?=\s*\w+=)/) : [];
  return raw.map((value) => value.split(";", 1)[0]).join("; ");
}

async function login() {
  const response = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl.origin,
    },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  if (!response.ok) fail(`login returned ${response.status}`);
  const cookie = collectCookies(response);
  if (!cookie.includes("authToken=")) fail("login omitted the auth cookie");
  return cookie;
}

async function connectWave(cookie, wave) {
  const sockets = Array.from({ length: 25 }, () =>
    io(baseUrl.origin, {
      transports: ["websocket"],
      extraHeaders: { cookie },
      forceNew: true,
      reconnection: false,
      timeout: 10_000,
    }),
  );
  try {
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise((resolvePromise, reject) => {
            socket.once("connect", resolvePromise);
            socket.once("connect_error", reject);
          }),
      ),
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    if (sockets.some((socket) => !socket.connected)) {
      fail(`Socket.IO wave ${wave} did not remain authenticated`);
    }
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

async function isHealthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  fail(`timed out waiting for ${description}`);
}

const cookie = await login();
for (let wave = 1; wave <= 10; wave += 1) {
  await connectWave(cookie, wave);
}

const trackedNames = [
  "docmost-app",
  "docmost-collab",
  "docmost-db",
  "docmost-redis",
];
const before = Object.fromEntries(
  await Promise.all(
    trackedNames.map(async (name) => [name, await inspectContainer(name)]),
  ),
);

const pidText = await docker(
  "exec",
  "docmost-app",
  "cat",
  "/proc/1/task/1/children",
);
const childPid = pidText.split(/\s+/).find((value) => /^\d+$/u.test(value));
if (!childPid) fail("API supervisor child PID was not found");

const faultStartedAt = Date.now();
await docker(
  "exec",
  "docmost-app",
  "node",
  "-e",
  "process.kill(Number(process.argv[1]), 'SIGSTOP')",
  childPid,
);

await waitFor(
  async () => !(await isHealthy(new URL("/api/health/live", baseUrl))),
  25_000,
  "the stopped API child to become unavailable",
);
if (!(await isHealthy(new URL("/api/health", collabUrl)))) {
  fail("collaboration readiness failed during API recovery");
}

await waitFor(
  async () => {
    const current = await inspectContainer("docmost-app");
    return (
      current.restartCount > before["docmost-app"].restartCount &&
      (await isHealthy(new URL("/api/health", baseUrl)))
    );
  },
  60_000,
  "API restart and readiness recovery",
);

const after = Object.fromEntries(
  await Promise.all(
    trackedNames.map(async (name) => [name, await inspectContainer(name)]),
  ),
);
for (const name of ["docmost-collab", "docmost-db", "docmost-redis"]) {
  if (
    after[name].id !== before[name].id ||
    after[name].restartCount !== before[name].restartCount
  ) {
    fail(`${name} restarted during independent API recovery`);
  }
}
if (after["docmost-app"].restartCount <= before["docmost-app"].restartCount) {
  fail("API container restart count did not increase");
}
if (!(await isHealthy(new URL("/api/health", collabUrl)))) {
  fail("collaboration readiness did not remain healthy");
}

console.log(
  JSON.stringify({
    event: "runtime_recovery_smoke_completed",
    socketWaves: 10,
    socketsPerWave: 25,
    recoveryMs: Date.now() - faultStartedAt,
    apiRestartDelta:
      after["docmost-app"].restartCount - before["docmost-app"].restartCount,
    dependentRestartDelta: 0,
  }),
);
