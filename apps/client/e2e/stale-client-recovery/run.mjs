import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium, firefox, webkit } from "@playwright/test";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = path.join(
  root,
  "artifacts/pwa-recovery",
  new Date().toISOString().replaceAll(":", "-"),
);
const source = path.join(output, "source");
const dist = path.join(output, "dist");
await mkdir(source, { recursive: true });
const recovery = path.join(
  root,
  "apps/client/src/lib/pwa/stale-client-recovery.ts",
);
const relative = path.relative(source, recovery).replaceAll("\\", "/");
await writeFile(
  path.join(source, "index.html"),
  '<!doctype html><title>Source fixture</title><p>Source fixture</p><script type="module" src="/entry.js"></script>',
);
for (const [name, value] of [
  ["pending", 0],
  ["failure-one", 1],
  ["failure-two", 2],
])
  await writeFile(
    path.join(source, name + ".js"),
    "export const AiDocumentContextSync = () => " + value + ";",
  );
await writeFile(
  path.join(source, "entry.js"),
  [
    "import { registerStaleClientRecovery } from " +
      JSON.stringify(relative) +
      ";",
    'window.probeEvents = []; function record(phase, extra = {}) { const item = { phase, path: location.pathname, ...extra }; window.probeEvents.push(item); console.log("PWA_PROBE:" + JSON.stringify(item)); }',
    'for (const phase of ["beforeunload", "pagehide", "pageshow"]) addEventListener(phase, (event) => record(phase, { persisted: event.persisted }));',
    'addEventListener("vite:preloadError", (event) => record("preload-error", { message: event.payload?.message }));',
    "registerStaleClientRecovery();",
    'function run(load) { window.probeSettled = false; load().then((module) => { const exported = !!module.AiDocumentContextSync; window.probeSettled = true; record("module-ready", {exported}); }).catch((error) => { window.probeSettled = true; record("module-error", {message:error.message}); }); }',
    'window.runModule = () => run(() => import("./pending.js"));',
    'window.runFailure = () => run(() => import("./failure-one.js"));',
    'window.runFailureTwo = () => run(() => import("./failure-two.js"));',
    'record("ready");',
  ].join("\n"),
);
await build({
  configFile: false,
  root: source,
  envDir: source,
  envPrefix: "DOCMOST_PWA_FIXTURE_PUBLIC_",
  logLevel: "silent",
  build: { outDir: dist, emptyOutDir: false },
});

const cases = [
  "pending module navigation and Back",
  "active stale asset recovery and throttle",
  "resumed pointer interaction",
  "resumed keyboard interaction",
  "untrusted interaction stays departed",
  "pageshow resumes recovery",
];
const report = {
  sourceSha256: createHash("sha256")
    .update(await readFile(recovery))
    .digest("hex"),
  synthetic: true,
  applicationEnvLoaded: false,
  results: [],
  passed: false,
};
const browserOption =
  process.argv.find((arg) => arg.startsWith("--browser="))?.slice(10) ?? "all";
assert(
  ["all", "chromium", "firefox", "webkit"].includes(browserOption),
  "Unknown browser",
);
const selected = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
].filter(([name]) => browserOption === "all" || browserOption === name);
let browser;
try {
  for (const [browserName, engine] of selected) {
    browser = await engine.launch({ headless: true });
    for (const name of cases) {
      const requests = [],
        events = [],
        held = new Set();
      let reached;
      const pending = new Promise((resolve) => {
        reached = resolve;
      });
      let pendingHeld = false;
      const server = createServer(async (request, response) => {
        const pathname = new URL(request.url, "http://localhost").pathname;
        requests.push(pathname);
        response.setHeader("Cache-Control", "no-store");
        if (/\/assets\/pending-.*\.js$/.test(pathname) && !pendingHeld) {
          pendingHeld = true;
          response.writeHead(200, { "Content-Type": "text/javascript" });
          response.flushHeaders();
          held.add(response);
          response.on("close", () => held.delete(response));
          reached();
          return;
        }
        if (/\/assets\/failure-.*\.js$/.test(pathname)) {
          response.writeHead(404).end();
          return;
        }
        if (pathname === "/next") {
          response.setHeader("Content-Type", "text/html");
          const timer = setTimeout(
            () =>
              response.end(
                "<!doctype html><title>Destination</title>Destination",
              ),
            1000,
          );
          response.on("close", () => clearTimeout(timer));
          return;
        }
        const target = path.resolve(
          dist,
          "." + (pathname === "/" ? "/index.html" : pathname),
        );
        if (!target.startsWith(dist + path.sep)) {
          response.writeHead(404).end();
          return;
        }
        try {
          response.setHeader(
            "Content-Type",
            target.endsWith(".js") ? "text/javascript" : "text/html",
          );
          response.end(await readFile(target));
        } catch {
          response.writeHead(404).end();
        }
      });
      let context;
      const result = {
        browser: browserName,
        name,
        passed: false,
        events,
        requests,
      };
      try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const origin = "http://127.0.0.1:" + server.address().port;
        context = await browser.newContext();
        const page = await context.newPage();
        page.on("console", (message) => {
          if (message.text().startsWith("PWA_PROBE:"))
            events.push(JSON.parse(message.text().slice(10)));
        });
        const ready = () =>
          page.waitForFunction(
            () => typeof window.runFailureTwo === "function",
          );
        const rootLoads = () =>
          requests.filter((pathname) => pathname === "/").length;
        const triggerRecovery = async (method = "runFailure") => {
          await Promise.all([
            page.waitForEvent("load"),
            page.evaluate((method) => window[method](), method),
          ]);
          await ready();
          assert.equal(rootLoads(), 2);
        };
        await page.goto(origin);
        await ready();
        if (name === cases[0]) {
          await page.evaluate(() => window.runModule());
          await pending;
          await page.goto(origin + "/next");
          assert.equal(new URL(page.url()).pathname, "/next");
          assert.equal(await page.title(), "Destination");
          assert.equal(rootLoads(), 1);
          assert(
            !events.some((event) => event.message?.includes("is undefined")),
          );
          await page.goBack();
          await ready();
          assert.equal(await page.title(), "Source fixture");
        } else if (name === cases[1]) {
          await triggerRecovery();
          await page.evaluate(() => window.runFailureTwo());
          await page.waitForFunction(() => window.probeSettled === true);
          assert.equal(rootLoads(), 2);
          assert.notEqual(
            await page.evaluate(() =>
              sessionStorage.getItem("docmost:stale-client-recovery"),
            ),
            null,
          );
        } else {
          await page.evaluate(() => dispatchEvent(new Event("beforeunload")));
          if (name === cases[2]) await page.mouse.click(24, 24);
          if (name === cases[3]) await page.keyboard.press("ArrowDown");
          if (name === cases[5])
            await page.evaluate(() => dispatchEvent(new Event("pageshow")));
          if (name === cases[4]) {
            await page.evaluate(() => dispatchEvent(new Event("pointerdown")));
            await page.evaluate(() => window.runFailure());
            await page.waitForFunction(() => window.probeSettled === true);
            assert.equal(rootLoads(), 1);
            assert.equal(
              await page.evaluate(() =>
                sessionStorage.getItem("docmost:stale-client-recovery"),
              ),
              null,
            );
          } else {
            await triggerRecovery();
          }
        }
        result.passed = true;
        console.log("Passed: " + browserName + " " + name);
      } catch (error) {
        result.error = error.message;
        throw error;
      } finally {
        report.results.push(result);
        await context?.close();
        for (const response of held) response.destroy();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
    await browser.close();
    browser = null;
  }
  report.passed = true;
} finally {
  await browser?.close();
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("PWA recovery receipt: " + path.relative(root, output));
}
