import { createServer } from "vite";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const browserArgs = args.filter((arg) => arg.startsWith("--browser="));
if (browserArgs.length > 1)
  throw new Error("Select one database browser option");
const browser = browserArgs[0]?.slice("--browser=".length);
if (browser && !["chromium", "firefox", "webkit", "all"].includes(browser))
  throw new Error("Invalid database browser option");
const browsers =
  browser === "all"
    ? ["chromium", "firefox", "webkit"]
    : browser
      ? [browser]
      : [];
const root = fileURLToPath(new URL("../..", import.meta.url));
const contractRoot = path.resolve(root, "../../packages/api-contract");
const contractRequire = createRequire(path.join(contractRoot, "package.json"));
const contractBuild = spawnSync(
  process.execPath,
  [
    contractRequire.resolve("typescript/bin/tsc"),
    "-p",
    path.join(contractRoot, "tsconfig.json"),
  ],
  { stdio: "inherit" },
);
if (contractBuild.error) throw contractBuild.error;
if (contractBuild.status !== 0)
  throw new Error("Database browser fixture API contract build failed");
const { createDatabaseFixtureApi } = await import("./synthetic-api.mjs");
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
  cacheDir: path.resolve(root, "../../artifacts/database/vite-cache"),
  optimizeDeps: { entries: ["e2e/database/fixture.html"] },
  server: { host: "127.0.0.1", port: 5195, strictPort: true, watch: null },
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
  const preparationStarted = Date.now();
  await server.listen();
  await server.warmupRequest("/e2e/database/fixture.tsx");
  await server.waitForRequestsIdle();
  console.log(`Database browser fixture prepared in ${Date.now() - preparationStarted}ms`);
  const child = spawn(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      path.join(root, "e2e/database/playwright.config.ts"),
      ...args.filter((arg) => !arg.startsWith("--browser=")),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_TABLES_OUTPUT_DIR: runDirectory,
        DATABASE_TABLES_BASE_URL: "http://127.0.0.1:5195",
        DATABASE_TABLES_BROWSERS: browsers.join(","),
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
