import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const compose = ["compose", "-f", "tests/rag-sync/compose.yml"];
const output = "output/audit/rag-sync-e2e";
await mkdir(output, { recursive: true });

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`)),
    );
  });
}

function capture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: false,
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", (error) => resolve(String(error)));
    child.once("exit", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:3200/api/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Isolated Docmost stack did not become healthy");
}

try {
  await run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
  const upArgs = ["up", "-d"];
  if (process.env.RAG_SYNC_E2E_SKIP_BUILD !== "true") upArgs.push("--build");
  await run("docker", [...compose, ...upArgs]);
  const proxyResponse = await fetch("http://127.0.0.1:18474/proxies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "open-webui",
      listen: "0.0.0.0:8666",
      upstream: "open-webui-fixture:8080",
      enabled: true,
    }),
  });
  if (!proxyResponse.ok) {
    throw new Error(`Toxiproxy setup returned ${proxyResponse.status}`);
  }
  await waitForHealth();
  await run(process.execPath, ["scripts/rag-sync-browser-e2e.mjs"], {
    env: {
      ...process.env,
      RAG_SYNC_E2E_OUTPUT: `${output}/screenshots`,
    },
  });
} catch (error) {
  const logs = await capture("docker", [...compose, "logs", "--no-color"]);
  await writeFile(`${output}/compose.log`, logs).catch(() => undefined);
  const fixtureState = await fetch("http://127.0.0.1:18081/__state")
    .then((response) => response.text())
    .catch((stateError) => String(stateError));
  await writeFile(`${output}/fixture-state.json`, fixtureState).catch(() => undefined);
  throw error;
} finally {
  if (process.env.RAG_SYNC_E2E_KEEP_STACK !== "true") {
    await run("docker", [...compose, "down", "--volumes", "--remove-orphans"]).catch(
      () => undefined,
    );
  }
}
