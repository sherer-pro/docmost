import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, request } from "playwright";
import { sanitizeAuditArtifacts } from "../apps/client/e2e/editor/sanitize-artifacts.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const baseUrl = (process.env.DOCMOST_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/u,
  "",
);
const apiBaseUrl = (
  process.env.DOCMOST_API_BASE_URL ?? baseUrl
).replace(/\/$/u, "");
const target = process.env.DOCMOST_PERFORMANCE_TARGET?.trim();
const quick = process.env.DOCMOST_PERFORMANCE_QUICK === "true";
const enforceGates =
  process.env.DOCMOST_PERFORMANCE_ENFORCE_GATES === "true";
const browserIterations = Number(
  process.env.DOCMOST_PERFORMANCE_BROWSER_ITERATIONS ?? (quick ? 2 : 4),
);
const navigationCycles = Number(
  process.env.DOCMOST_PERFORMANCE_NAVIGATION_CYCLES ?? (quick ? 4 : 20),
);
const warmupMs = Number(
  process.env.DOCMOST_PERFORMANCE_WARMUP_MS ?? (quick ? 2_000 : 120_000),
);
const stageDurationMs = Number(
  process.env.DOCMOST_PERFORMANCE_STAGE_MS ?? (quick ? 5_000 : 300_000),
);
const stageSessions = (process.env.DOCMOST_PERFORMANCE_SESSIONS ?? "1,10,25,50")
  .split(",")
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0 && value <= 50);
const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
const outputRoot = path.resolve(
  process.env.DOCMOST_PERFORMANCE_OUTPUT ??
    path.join(repoRoot, "output", "audit", `performance-${timestamp}`),
);
const traceDirectory = path.join(outputRoot, "playwright-artifacts");

export function percentile(values, targetPercentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((targetPercentile / 100) * sorted.length) - 1,
  );
  return Number(sorted[index].toFixed(2));
}

export function summarize(values) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length > 0 ? Number(Math.max(...values).toFixed(2)) : null,
  };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied at runtime`);
  return value;
}

function unwrap(payload) {
  return payload &&
    typeof payload === "object" &&
    payload.success === true &&
    "data" in payload
    ? payload.data
    : payload;
}

async function responseJson(response) {
  const text = await response.text();
  if (!response.ok()) {
    throw new Error(
      `${new URL(response.url()).pathname} failed with ${response.status()}: ${text.slice(0, 300)}`,
    );
  }
  return text ? unwrap(JSON.parse(text)) : undefined;
}

function validateExecutionBoundary() {
  if (target !== "staging") {
    throw new Error(
      "DOCMOST_PERFORMANCE_TARGET=staging is required; synthetic load is forbidden in production",
    );
  }
  if (process.env.DOCMOST_PERFORMANCE_ALLOW_MUTATIONS !== "true") {
    throw new Error(
      "DOCMOST_PERFORMANCE_ALLOW_MUTATIONS=true is required to create isolated fixtures",
    );
  }
  const revision = required("DOCMOST_PERFORMANCE_REVISION");
  if (revision === "unknown") {
    throw new Error("Performance results with revision=unknown are not comparable");
  }
  const digest = required("DOCMOST_PERFORMANCE_IMAGE_DIGEST");
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error("DOCMOST_PERFORMANCE_IMAGE_DIGEST must be a sha256 digest");
  }
  if (stageSessions.length === 0 || Math.max(...stageSessions) > 50) {
    throw new Error("Performance sessions must contain values from 1 through 50");
  }
}

async function createAuthenticatedContexts() {
  const email = required("DOCMOST_ADMIN_EMAIL");
  const password = required("DOCMOST_ADMIN_PASSWORD");
  const origin = new URL(baseUrl).origin;
  const login = await request.newContext({
    baseURL: apiBaseUrl,
    extraHTTPHeaders: { Origin: origin, Referer: `${origin}/` },
  });
  const loginResponse = await login.post("/api/auth/login", {
    data: { email, password },
  });
  if (!loginResponse.ok()) {
    throw new Error(`Performance login failed with ${loginResponse.status()}`);
  }
  const storageState = await login.storageState();
  const authToken = storageState.cookies.find(
    (cookie) => cookie.name === "authToken",
  )?.value;
  const csrfToken = storageState.cookies.find(
    (cookie) => cookie.name === "csrfToken",
  )?.value;
  await login.dispose();
  if (!authToken || !csrfToken) {
    throw new Error("Performance login did not return auth and CSRF cookies");
  }

  process.env.DOCMOST_AUTH_TOKEN = authToken;
  process.env.DOCMOST_CSRF_TOKEN = csrfToken;
  const api = await request.newContext({
    baseURL: apiBaseUrl,
    timeout: 30_000,
    extraHTTPHeaders: {
      Authorization: `Bearer ${authToken}`,
      Cookie: `csrfToken=${csrfToken}`,
      Origin: origin,
      Referer: `${origin}/`,
      "x-csrf-token": csrfToken,
      Accept: "application/json",
    },
  });
  return { api, storageState };
}

function paragraph(index, prefix) {
  return {
    type: "paragraph",
    content: [
      {
        type: "text",
        text: `${prefix} ${index}. Synthetic performance fixture text with stable length and no user data.`,
      },
    ],
  };
}

function pageContent(paragraphCount, references) {
  const mentions = references.map((reference) => ({
    type: "paragraph",
    content: [
      { type: "text", text: "Reference " },
      {
        type: "mention",
        attrs: {
          id: randomUUID(),
          label: reference.title,
          entityType: "page",
          entityId: reference.id,
          slugId: reference.slugId,
          icon: reference.icon,
        },
      },
    ],
  }));
  return {
    type: "doc",
    content: [
      ...mentions,
      ...Array.from({ length: paragraphCount }, (_, index) =>
        paragraph(index, "Fixture"),
      ),
    ],
  };
}

async function createPage(api, input) {
  const page = await responseJson(
    await api.post("/api/pages", {
      data: {
        spaceId: input.spaceId,
        title: input.title,
        content: input.content,
        format: "json",
      },
    }),
  );
  await responseJson(
    await api.post("/api/pages/actions/update", {
      data: {
        pageId: page.id,
        content: input.content,
        format: "json",
        operation: "replace",
      },
    }),
  );
  return page;
}

async function provisionFixtures(api) {
  const runId = timestamp.replace(/[^0-9]/gu, "").slice(0, 14);
  const space = await responseJson(
    await api.post("/api/spaces", {
      data: {
        name: `Performance audit ${runId}`,
        slug: `performanceaudit${runId}`,
        description: "Isolated synthetic performance fixtures.",
      },
    }),
  );
  const references = [];
  for (let index = 0; index < 10; index += 1) {
    references.push(
      await createPage(api, {
        spaceId: space.id,
        title: `Reference ${index + 1}`,
        content: pageContent(1, []),
      }),
    );
  }
  const sizes = {
    p50: Number(process.env.DOCMOST_PERFORMANCE_P50_PARAGRAPHS ?? 250),
    p95: Number(process.env.DOCMOST_PERFORMANCE_P95_PARAGRAPHS ?? 1200),
    p99: Number(process.env.DOCMOST_PERFORMANCE_P99_PARAGRAPHS ?? 4000),
  };
  const pages = {};
  for (const [profile, paragraphCount] of Object.entries(sizes)) {
    pages[profile] = await createPage(api, {
      spaceId: space.id,
      title: `Performance ${profile}`,
      content: pageContent(paragraphCount, references),
    });
  }
  return { space, pages, references, sizes };
}

function pagePath(fixtures, profile) {
  const page = fixtures.pages[profile];
  return `/s/${fixtures.space.slug}/p/${page.slugId}`;
}

async function installPerformanceObservers(page) {
  await page.addInitScript(() => {
    const state = { longTasks: [], lcp: [] };
    window.__docmostPerformance = {
      state,
      reset() {
        state.longTasks.length = 0;
        state.lcp.length = 0;
      },
    };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: "longtask", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.lcp.push(entry.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Unsupported metrics stay empty and are reported as unavailable.
    }
  });
}

async function collectBrowserMetrics(page, startedAt, editableTimeoutMs = 15_000) {
  await page.locator(".ProseMirror").first().waitFor({ state: "visible" });
  const contentVisibleMs = Date.now() - startedAt;
  let editableMs = null;
  try {
    await page
      .locator('.ProseMirror[contenteditable="true"]')
      .first()
      .waitFor({ state: "visible", timeout: editableTimeoutMs });
    editableMs = Date.now() - startedAt;
  } catch {
    editableMs = null;
  }
  await page.waitForTimeout(250);
  const browser = await page.evaluate(() => {
    const state = window.__docmostPerformance?.state ?? {
      longTasks: [],
      lcp: [],
    };
    const resources = performance.getEntriesByType("resource");
    const longTaskDurations = state.longTasks.map((entry) => entry.duration);
    return {
      lcpMs: state.lcp.at(-1) ?? null,
      longTasks: longTaskDurations.length,
      maxLongTaskMs:
        longTaskDurations.length > 0 ? Math.max(...longTaskDurations) : 0,
      tbtMs: longTaskDurations.reduce(
        (total, duration) => total + Math.max(0, duration - 50),
        0,
      ),
      domNodes: document.getElementsByTagName("*").length,
      resourceTransferBytes: resources.reduce(
        (total, entry) => total + (entry.transferSize ?? 0),
        0,
      ),
      resourceDecodedBytes: resources.reduce(
        (total, entry) => total + (entry.decodedBodySize ?? 0),
        0,
      ),
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  });
  return { contentVisibleMs, editableMs, ...browser };
}

async function collectHeapAfterGc(page, cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  return page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
}

async function navigateSpa(page, targetPath, expectedTitle) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.__docmostPerformance?.reset();
  }, targetPath);
  await page.waitForFunction(
    (title) => document.title.includes(title),
    expectedTitle,
  );
}

async function runBrowserAudit(storageState, fixtures) {
  const harPath = path.join(traceDirectory, "p95-browser.har");
  const tracePath = path.join(traceDirectory, "p95-cold-trace.zip");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: baseUrl,
    storageState,
    recordHar: { path: harPath, mode: "minimal", content: "omit" },
  });
  const page = await context.newPage();
  await installPerformanceObservers(page);
  const networkCounts = { pageInfo: 0, references: 0, comments: 0 };
  page.on("request", (requestEvent) => {
    const pathname = new URL(requestEvent.url()).pathname;
    if (pathname === "/api/pages/info") networkCounts.pageInfo += 1;
    if (pathname === "/api/pages/references") networkCounts.references += 1;
    if (pathname === "/api/comments") networkCounts.comments += 1;
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const coldStartedAt = Date.now();
  await page.goto(pagePath(fixtures, "p95"), { waitUntil: "domcontentloaded" });
  const cold = await collectBrowserMetrics(page, coldStartedAt);
  await context.tracing.stop({ path: tracePath });
  const initialNetwork = { ...networkCounts };

  const warm = [];
  for (let index = 0; index < browserIterations; index += 1) {
    await navigateSpa(
      page,
      pagePath(fixtures, "p50"),
      fixtures.pages.p50.title,
    );
    const startedAt = Date.now();
    await navigateSpa(
      page,
      pagePath(fixtures, "p95"),
      fixtures.pages.p95.title,
    );
    warm.push(await collectBrowserMetrics(page, startedAt));
  }

  const cdp = await context.newCDPSession(page);
  const heapAfterGc = [];
  for (let index = 0; index < navigationCycles; index += 1) {
    const profile = index % 2 === 0 ? "p99" : "p95";
    await navigateSpa(
      page,
      pagePath(fixtures, profile),
      fixtures.pages[profile].title,
    );
    await page.locator(".ProseMirror").first().waitFor({ state: "visible" });
    heapAfterGc.push(await collectHeapAfterGc(page, cdp));
  }
  await context.close();
  await browser.close();

  const validHeap = heapAfterGc.filter((value) => typeof value === "number");
  const referenceWindow = validHeap.slice(1, 5);
  const referenceMedian = percentile(referenceWindow, 50);
  const finalHeap = validHeap.at(-1) ?? null;
  const heapGrowthRatio =
    referenceMedian && finalHeap ? finalHeap / referenceMedian - 1 : null;
  const monotonicallyIncreasing =
    validHeap.length > 1 &&
    validHeap.every((value, index) => index === 0 || value > validHeap[index - 1]);

  return {
    cold,
    warm: {
      runs: warm,
      contentVisibleMs: summarize(warm.map((run) => run.contentVisibleMs)),
      editableMs: summarize(
        warm
          .map((run) => run.editableMs)
          .filter((value) => typeof value === "number"),
      ),
      tbtMs: summarize(warm.map((run) => run.tbtMs)),
      maxLongTaskMs: Math.max(...warm.map((run) => run.maxLongTaskMs), 0),
    },
    navigationCycles: {
      count: navigationCycles,
      heapAfterGc,
      referenceMedianBytes: referenceMedian,
      finalHeapBytes: finalHeap,
      growthRatio: heapGrowthRatio,
      monotonicallyIncreasing,
    },
    initialNetwork,
  };
}

function createLoadRecorder() {
  const samples = new Map();
  const failures = [];
  return {
    record(route, durationMs, response) {
      const values = samples.get(route) ?? [];
      values.push(durationMs);
      samples.set(route, values);
      if (response.status() >= 500) {
        failures.push({ route, statusClass: "5xx" });
      }
    },
    fail(route, error) {
      failures.push({
        route,
        statusClass: "timeout-or-network",
        message: error instanceof Error ? error.name : "unknown",
      });
    },
    report() {
      return {
        routes: Object.fromEntries(
          [...samples.entries()].map(([route, values]) => [
            route,
            summarize(values),
          ]),
        ),
        all: summarize([...samples.values()].flat()),
        failures,
      };
    },
  };
}

async function timedGet(api, recorder, route, url) {
  const startedAt = performance.now();
  try {
    const response = await api.get(url);
    recorder.record(route, performance.now() - startedAt, response);
  } catch (error) {
    recorder.fail(route, error);
  }
}

async function runVirtualSession(api, recorder, fixtures, deadline, index) {
  let iteration = index;
  const ids = fixtures.references.map((page) => page.id).join(",");
  while (performance.now() < deadline) {
    const profile = iteration % 10 === 0 ? "p99" : "p95";
    const pageId = fixtures.pages[profile].id;
    await timedGet(
      api,
      recorder,
      "GET /api/pages/sidebar-pages",
      `/api/pages/sidebar-pages?spaceId=${fixtures.space.id}&limit=50`,
    );
    await timedGet(
      api,
      recorder,
      "GET /api/pages/info",
      `/api/pages/info?pageId=${pageId}`,
    );
    await timedGet(
      api,
      recorder,
      "GET /api/pages/references",
      `/api/pages/references?ids=${encodeURIComponent(ids)}`,
    );
    if (iteration % 5 === 0) {
      await timedGet(
        api,
        recorder,
        "GET /api/comments",
        `/api/comments?pageId=${pageId}&limit=500`,
      );
    }
    iteration += 1;
    await new Promise((resolve) => setTimeout(resolve, 250 + (index % 5) * 50));
  }
}

async function runApiStage(api, fixtures, sessions, durationMs) {
  const recorder = createLoadRecorder();
  const deadline = performance.now() + durationMs;
  await Promise.all(
    Array.from({ length: sessions }, (_, index) =>
      runVirtualSession(api, recorder, fixtures, deadline, index),
    ),
  );
  return { sessions, durationMs, ...recorder.report() };
}

async function runApiAudit(api, fixtures) {
  await runApiStage(api, fixtures, Math.min(10, Math.max(...stageSessions)), warmupMs);
  const stages = [];
  for (const sessions of stageSessions) {
    stages.push(await runApiStage(api, fixtures, sessions, stageDurationMs));
  }
  return { warmupMs, stages };
}

async function readBaseline() {
  const baselinePath = process.env.DOCMOST_PERFORMANCE_BASELINE?.trim();
  if (!baselinePath) return null;
  return JSON.parse(await fs.readFile(path.resolve(baselinePath), "utf8"));
}

export function evaluateGates(browserReport, apiReport, baseline) {
  const isWithin = (value, maximum) =>
    typeof value === "number" && Number.isFinite(value) && value <= maximum;
  const maxStage = apiReport.stages.find(
    (stage) => stage.sessions === Math.max(...apiReport.stages.map((item) => item.sessions)),
  );
  const candidateTbt = browserReport.warm.tbtMs.p75;
  const baselineBrowser = baseline?.browser ?? baseline;
  const baselineTbt = baselineBrowser?.warm?.tbtMs?.p75 ?? null;
  const relativeTbtImprovement =
    baselineTbt && candidateTbt !== null
      ? 1 - candidateTbt / baselineTbt
      : null;
  const gates = {
    warmContentVisibleP75: isWithin(
      browserReport.warm.contentVisibleMs.p75,
      1500,
    ),
    editableP75: isWithin(browserReport.warm.editableMs.p75, 3000),
    maxLongTask: isWithin(browserReport.warm.maxLongTaskMs, 200),
    tbtP75: isWithin(browserReport.warm.tbtMs.p75, 500),
    tbtImprovement30Percent:
      relativeTbtImprovement === null ? null : relativeTbtImprovement >= 0.3,
    heapGrowth:
      browserReport.navigationCycles.growthRatio !== null &&
      browserReport.navigationCycles.growthRatio <= 0.2 &&
      !browserReport.navigationCycles.monotonicallyIncreasing,
    initialMentionsBatch:
      browserReport.initialNetwork.references <= 1 &&
      browserReport.initialNetwork.pageInfo <= 1,
    commentsDeferred: browserReport.initialNetwork.comments === 0,
    apiP95: isWithin(maxStage?.all.p95, 300),
    apiP99: isWithin(maxStage?.all.p99, 750),
    apiFailures: (maxStage?.failures.length ?? 1) === 0,
  };
  return { gates, relativeTbtImprovement };
}

async function writeReports(metadata, browserReport, apiReport, evaluation) {
  await fs.writeFile(
    path.join(outputRoot, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(outputRoot, "browser.json"),
    `${JSON.stringify(browserReport, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(outputRoot, "api.json"),
    `${JSON.stringify(apiReport, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(outputRoot, "evaluation.json"),
    `${JSON.stringify(evaluation, null, 2)}\n`,
  );
  const lines = [
    "# Docmost performance audit",
    "",
    `- Revision: ${metadata.revision}`,
    `- Image digest: ${metadata.imageDigest}`,
    `- Target: ${metadata.target}`,
    `- Mode: ${metadata.quick ? "quick" : "full"}`,
    `- Page route: synthetic p50/p95/p99 fixtures`,
    "",
    "## Gates",
    "",
    ...Object.entries(evaluation.gates).map(
      ([name, passed]) => `- ${name}: ${passed === null ? "NOT EVALUATED" : passed ? "PASS" : "FAIL"}`,
    ),
    "",
    "## Key measurements",
    "",
    `- Warm content visible p75: ${browserReport.warm.contentVisibleMs.p75} ms`,
    `- Warm editable p75: ${browserReport.warm.editableMs.p75} ms`,
    `- Warm TBT p75: ${browserReport.warm.tbtMs.p75} ms`,
    `- Maximum long task: ${browserReport.warm.maxLongTaskMs} ms`,
    `- Heap growth after GC: ${browserReport.navigationCycles.growthRatio}`,
    "",
  ];
  await fs.writeFile(path.join(outputRoot, "summary.md"), `${lines.join("\n")}\n`);
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "See docs/PERFORMANCE_TESTING.md. Full mode runs 2 minutes of warmup and 5 minutes at 1, 10, 25, and 50 sessions.",
    );
    return;
  }
  validateExecutionBoundary();
  await fs.mkdir(traceDirectory, { recursive: true });
  const metadata = {
    capturedAt: new Date().toISOString(),
    target,
    baseOrigin: new URL(baseUrl).origin,
    revision: required("DOCMOST_PERFORMANCE_REVISION"),
    imageDigest: required("DOCMOST_PERFORMANCE_IMAGE_DIGEST"),
    localCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim(),
    quick,
    browserIterations,
    navigationCycles,
    warmupMs,
    stageDurationMs,
    stageSessions,
    runtime: process.env.DOCMOST_PERFORMANCE_RUNTIME_METADATA_JSON
      ? JSON.parse(process.env.DOCMOST_PERFORMANCE_RUNTIME_METADATA_JSON)
      : null,
  };
  const { api, storageState } = await createAuthenticatedContexts();
  let fixtures;
  let succeeded = false;
  try {
    fixtures = await provisionFixtures(api);
    const [baseline, browserReport] = await Promise.all([
      readBaseline(),
      runBrowserAudit(storageState, fixtures),
    ]);
    const apiReport = await runApiAudit(api, fixtures);
    const evaluation = evaluateGates(browserReport, apiReport, baseline);
    await writeReports(metadata, browserReport, apiReport, evaluation);
    const sanitization = await sanitizeAuditArtifacts(outputRoot);
    if (sanitization.credentialFindings > 0) {
      throw new Error("Credential material remained in performance artifacts");
    }
    const failedGates = Object.entries(evaluation.gates).filter(
      ([, passed]) => passed === false,
    );
    succeeded = failedGates.length === 0;
    if (enforceGates && !succeeded) {
      throw new Error(
        `Performance gates failed: ${failedGates.map(([name]) => name).join(", ")}`,
      );
    }
    console.log(`Performance artifacts: ${outputRoot}`);
  } finally {
    if (fixtures && (succeeded || process.env.DOCMOST_PERFORMANCE_RETAIN_FIXTURES !== "true")) {
      await responseJson(await api.delete(`/api/spaces/${fixtures.space.id}`)).catch(
        () => undefined,
      );
    }
    await api.dispose();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
