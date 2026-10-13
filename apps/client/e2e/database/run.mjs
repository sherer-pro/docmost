import { createServer } from "vite";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDatabaseFixtureApi } from "./synthetic-api.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../..", import.meta.url));
process.chdir(root);
process.env.APP_URL = "http://127.0.0.1:5195";
const api = createDatabaseFixtureApi();
const runDirectory = path.resolve(
  root,
  "../../artifacts/database/browser",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const server = await createServer({
  root,
  mode: "test",
  server: { host: "127.0.0.1", port: 5195, strictPort: true },
  plugins: [
    {
      name: "database-acceptance-api",
      configureServer: (server) => {
        server.middlewares.use("/api", api);
      },
    },
  ],
});
try {
  await server.listen();
  const child = spawn(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      path.join(root, "e2e/database/playwright.config.ts"),
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_TABLES_OUTPUT_DIR: runDirectory,
        DATABASE_TABLES_BASE_URL: "http://127.0.0.1:5195",
      },
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await server.close();
}
