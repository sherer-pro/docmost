import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const composeArgs = [
  "compose",
  "-f",
  "tests/rag-sync/compose.yml",
  "--profile",
  "real-open-webui",
];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
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

try {
  await run("docker", [...composeArgs, "up", "-d", "open-webui"]);
  await run(process.execPath, ["scripts/rag-open-webui-compat.mjs"]);
} catch (error) {
  await mkdir("output/audit", { recursive: true });
  const logs = await capture("docker", [...composeArgs, "logs", "--no-color", "open-webui"]);
  await writeFile("output/audit/open-webui.log", logs);
  throw error;
} finally {
  await run("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"]).catch(
    () => undefined,
  );
}
