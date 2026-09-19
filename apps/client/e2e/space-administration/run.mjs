import { createServer } from "vite";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const clientRoot = fileURLToPath(new URL("../..", import.meta.url));
process.chdir(clientRoot);
process.env.APP_URL = "http://127.0.0.1:5194";
const server = await createServer({
  root: clientRoot,
  server: { host: "127.0.0.1", port: 5193, strictPort: true },
  mode: "test",
});
try {
  await server.listen();
  const child = spawn(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      path.join(clientRoot, "e2e/space-administration/playwright.config.ts"),
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, SPACES_ADMIN_BASE_URL: "http://127.0.0.1:5193" },
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await server.close();
}
