import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, firefox, webkit, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const client = path.join(root, "apps/client");
const require = createRequire(path.join(client, "package.json"));
const output = path.join(
  root,
  "artifacts/pwa-runtime-config",
  new Date().toISOString().replaceAll(":", "-"),
);
const source = path.join(output, "source");
const dist = path.join(output, "dist");
const main = path.join(client, "src/main.tsx");
const app = path.join(source, "app.jsx");
await mkdir(source, { recursive: true });
await writeFile(
  path.join(source, "index.html"),
  '<!doctype html><div id="root"></div><script src="/window-config.js"></script><script type="module" src="/entry.js"></script>',
);
await writeFile(
  path.join(source, "entry.js"),
  `import ${JSON.stringify(path.relative(source, main).replaceAll("\\", "/"))};`,
);
await writeFile(
  app,
  [
    'import React from "react";',
    `import { Link } from ${JSON.stringify(require.resolve("react-router-dom").replaceAll("\\", "/"))};`,
    `import { getCollaborationUrl } from ${JSON.stringify(path.join(client, "src/lib/config.ts").replaceAll("\\", "/"))};`,
    'function Home() { return <><p>Home fixture</p><Link to="/document">Open document</Link></>; }',
    "function Document() { React.useEffect(() => { window.documentMounts = (window.documentMounts ?? 0) + 1; }, []); return <><p>Document fixture</p><span>{getCollaborationUrl()}</span></>; }",
    'export function createAppRoutes() { window.startupEvaluation = (window.startupEvaluation ?? 0) + 1; window.configuredCloud = window.CONFIG?.CLOUD; return [{ path: "/", element: <Home /> }, { path: "/document", element: <Document /> }]; }',
  ].join("\n"),
);
await build({
  configFile: false,
  root: source,
  envDir: source,
  envPrefix: "DOCMOST_PWA_FIXTURE_PUBLIC_",
  logLevel: "silent",
  define: { APP_VERSION: JSON.stringify("fixture") },
  plugins: [
    react(),
    {
      name: "runtime-config-startup-fixture",
      enforce: "pre",
      transform(code, id) {
        if (path.normalize(id.split("?")[0]) !== main) return;
        const needle = 'from "./App.tsx"';
        assert(
          code.includes(needle),
          "Startup fixture must replace the route module import",
        );
        return code.replace(
          needle,
          `from ${JSON.stringify(app.replaceAll("\\", "/"))}`,
        );
      },
      resolveId(id, importer) {
        if (id === "./App.tsx" && path.normalize(importer ?? "") === main)
          return app;
        if (
          id === "@/features/auth/utils/client-session-cleanup.ts" ||
          path.normalize(id) ===
            path.join(
              client,
              "src/features/auth/utils/client-session-cleanup.ts",
            )
        )
          return "\0fixture-session";
        if (
          id === "@/lib/pwa/register-service-worker.ts" ||
          path.normalize(id) ===
            path.join(client, "src/lib/pwa/register-service-worker.ts")
        )
          return "\0fixture-worker";
      },
      load(id) {
        if (id === "\0fixture-session")
          return "export function registerLogoutSync() {} export async function clearSensitiveClientState() {}";
        if (id === "\0fixture-worker")
          return "export function registerServiceWorker() {}";
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.join(client, "src"),
      react: path.dirname(require.resolve("react/package.json")),
      "react-dom": path.dirname(require.resolve("react-dom/package.json")),
    },
  },
  build: { outDir: dist, emptyOutDir: false },
});

const cases = [
  "preloaded config",
  "transient config failure",
  "invalid config retry",
  "online config recovery",
  "manual config retry",
];
const selected =
  process.argv.find((arg) => arg.startsWith("--browser="))?.slice(10) ?? "all";
const report = {
  synthetic: true,
  applicationEnvLoaded: false,
  sourceSha256: {},
  results: [],
  passed: false,
};
for (const file of [
  "src/main.tsx",
  "src/App.tsx",
  "src/lib/pwa/runtime-config.ts",
  "src/components/ui/route-error.tsx",
]) {
  report.sourceSha256[file] = createHash("sha256")
    .update(await readFile(path.join(client, file)))
    .digest("hex");
}
let browser;
try {
  for (const [browserName, engine] of [
    ["chromium", chromium],
    ["firefox", firefox],
    ["webkit", webkit],
  ]) {
    if (selected !== "all" && selected !== browserName) continue;
    browser = await engine.launch({ headless: true });
    for (const name of cases) {
      let available =
        !name.includes("recovery") && name !== "manual config retry";
      let configRequests = 0;
      let documentRequests = 0;
      const errors = [];
      const server = createServer(async (request, response) => {
        const pathname = new URL(request.url, "http://localhost").pathname;
        response.setHeader("Cache-Control", "no-store");
        if (pathname === "/window-config.js") {
          configRequests++;
          response.setHeader("Content-Type", "application/javascript");
          if (!available || (name === cases[1] && configRequests <= 2)) {
            response.writeHead(503).end();
            return;
          }
          if (name === cases[2] && configRequests <= 2) {
            response.end("window.CONFIG = {};");
            return;
          }
          response.end(
            'window.CONFIG = { APP_URL: "https://example.test", COLLAB_URL: "https://collab.example.test", CLOUD: true };',
          );
          return;
        }
        const isDocument = pathname === "/" || pathname === "/document";
        if (isDocument) documentRequests++;
        const base = pathname.startsWith("/locales/")
          ? path.join(client, "public")
          : dist;
        const target = path.resolve(
          base,
          "." + (isDocument ? "/index.html" : pathname),
        );
        if (!target.startsWith(base + path.sep)) {
          response.writeHead(404).end();
          return;
        }
        try {
          response.setHeader(
            "Content-Type",
            target.endsWith(".js")
              ? "application/javascript"
              : target.endsWith(".css")
                ? "text/css"
                : target.endsWith(".json")
                  ? "application/json"
                  : "text/html",
          );
          response.end(await readFile(target));
        } catch {
          response.writeHead(404).end();
        }
      });
      let context;
      const result = { browser: browserName, name, passed: false, errors };
      try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
          viewport: { width: 393, height: 852 },
          locale: "en-US",
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        const initial = available ? "/" : "/document?retained=1#notes";
        await page.goto(origin + initial);
        if (!available) {
          await expect(page.getByTestId("route-error")).toBeVisible();
          assert.equal(configRequests, 4);
          assert.equal(
            await page.evaluate(() => window.startupEvaluation),
            undefined,
          );
          available = true;
          if (name === cases[3])
            await page.evaluate(() => dispatchEvent(new Event("online")));
          else await page.getByRole("button", { name: "Try again" }).click();
        } else {
          await expect(page.getByText("Home fixture")).toBeVisible();
          await page.getByRole("link", { name: "Open document" }).click();
        }
        await expect(page.getByText("Document fixture")).toBeVisible();
        await expect(
          page.getByText("wss://collab.example.test/collab", { exact: true }),
        ).toBeVisible();
        assert.equal(documentRequests, 1);
        assert.equal(await page.evaluate(() => window.startupEvaluation), 1);
        assert.equal(await page.evaluate(() => window.configuredCloud), true);
        assert.equal(new URL(page.url()).pathname, "/document");
        if (initial !== "/") assert.equal(page.url(), origin + initial);
        assert.equal(
          configRequests,
          name === cases[0]
            ? 1
            : name === cases[1] || name === cases[2]
              ? 3
              : 5,
        );
        await page.evaluate(() => dispatchEvent(new Event("online")));
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await expect(page.getByText("Document fixture")).toBeVisible();
        assert.equal(await page.evaluate(() => window.startupEvaluation), 1);
        assert.equal(await page.evaluate(() => window.documentMounts), 1);
        assert.deepEqual(errors, []);
        result.passed = true;
        result.configRequests = configRequests;
        result.documentRequests = documentRequests;
        console.log(`Passed: ${browserName} ${name}`);
      } catch (error) {
        result.error = error.message;
        throw error;
      } finally {
        report.results.push(result);
        await context?.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
    await browser.close();
    browser = undefined;
  }
  report.passed = true;
} finally {
  await browser?.close();
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("PWA runtime config receipt: " + path.relative(root, output));
}
