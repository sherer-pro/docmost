import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  applicationAuditCommand,
  applicationAuditEnvironment,
  applicationAuditMode,
  applicationLogErrorSummary,
  applicationLogScanResult,
  createApplicationLogCapture,
  createApplicationLogScanService,
  nativeApplicationLogScanResult,
  requestApplicationLogScan,
  scanDockerApplicationLogs,
  unavailableApplicationLogScan,
  validateApplicationLogScanUrl,
} from "./ai-application-log-scan.mjs";

const canary = "synthetic-private-canary-83791";
const patterns = [{ label: "canary", value: canary }];
const noSecrets = (result, values = [canary]) => {
  for (const value of values)
    assert.equal(JSON.stringify(result).includes(value), false);
};
const cleanCapture = () => {
  const capture = createApplicationLogCapture();
  capture.append("api", "API ready\n");
  capture.append("collaboration", "Collaboration ready\n");
  return capture;
};

test("joined error summaries redact known secrets reconstructed across source chunks", () => {
  const secret = "bare-known-secret-29741";
  const redact = (value) => value.replaceAll(secret, "[REDACTED]");
  const chunks = ["ERROR bare-known-", "secret-29741 failed"];
  const reconstructedTail = chunks.map(redact).join("");
  assert(reconstructedTail.includes(secret));
  const summary = applicationLogErrorSummary([reconstructedTail], redact);
  assert.equal(summary.includes(secret), false);
  assert.equal(summary, "ERROR [REDACTED] failed");
});

test("native scans require both roles and reject forged complete byte metadata", () => {
  const capture = cleanCapture();
  const valid = capture.scan(patterns);
  assert.equal(nativeApplicationLogScanResult(valid).passed, true);
  for (const source of valid.sources) {
    const missingRole = {
      ...valid,
      sources: [source],
      bytesScanned: source.bytesScanned,
      bytesObserved: source.bytesObserved,
    };
    assert.equal(applicationLogScanResult(missingRole).passed, true);
    assert.equal(nativeApplicationLogScanResult(missingRole).passed, false);
  }
  const observedMoreThanScanned = {
    ...valid,
    bytesObserved: valid.bytesObserved + 1,
    sources: valid.sources.map((source, index) =>
      index === 0
        ? { ...source, bytesObserved: source.bytesObserved + 1 }
        : source,
    ),
  };
  assert.equal(
    nativeApplicationLogScanResult(observedMoreThanScanned).passed,
    false,
  );
  assert.equal(
    nativeApplicationLogScanResult(observedMoreThanScanned).complete,
    false,
  );
  assert.equal(
    nativeApplicationLogScanResult({
      ...valid,
      sources: [valid.sources[0], valid.sources[0]],
    }).passed,
    false,
  );
  assert.equal(
    nativeApplicationLogScanResult({
      ...valid,
      bytesScanned: valid.bytesScanned + 1,
      bytesObserved: valid.bytesObserved + 1,
    }).passed,
    false,
  );
  capture.dispose();
});

test("isolated diagnostic is a fixed AI-only preset and cannot shorten release acceptance", () => {
  assert.equal(applicationAuditMode(["--release"]), "release");
  assert.equal(
    applicationAuditCommand("release"),
    "corepack pnpm verify:release",
  );
  assert.equal(
    applicationAuditMode(["--ai-browser-only", "--subnet=10.241.234.0/28"]),
    "ai-browser-only",
  );
  assert.equal(
    applicationAuditCommand("ai-browser-only"),
    "corepack pnpm test:ai:e2e",
  );
  for (const flag of [
    "--release",
    "--editor-browser-only",
    "--ai-quality",
    "--browser=all",
    "--grep=anything",
    "--api-only",
    "--skip-postgres",
  ])
    assert.throws(() => applicationAuditMode(["--ai-browser-only", flag]));
  assert.throws(() =>
    applicationAuditMode(["--ai-browser-only", "--ai-browser-only"]),
  );
  assert.throws(() =>
    applicationAuditMode(["--ai-browser-only", "--subnet=a", "--subnet=b"]),
  );
  assert.throws(() => applicationAuditCommand("anything"));
});

test("editor diagnostic fixes the Firefox synced-blocks selection and rejects subsets", () => {
  assert.equal(
    applicationAuditMode(["--editor-browser-only"]),
    "editor-browser-only",
  );
  assert.equal(
    applicationAuditMode(["--editor-browser-only", "--subnet=10.241.244.0/28"]),
    "editor-browser-only",
  );
  assert.equal(
    applicationAuditCommand("editor-browser-only"),
    "corepack pnpm test:editor:e2e",
  );
  assert.deepEqual(applicationAuditEnvironment("editor-browser-only"), {
    DOCMOST_EDITOR_AUDIT_FILES: "synced-blocks.spec.ts",
    DOCMOST_EDITOR_AUDIT_PROJECTS: "firefox-desktop",
  });
  assert.deepEqual(applicationAuditEnvironment("release"), {});
  assert.deepEqual(applicationAuditEnvironment("ai-browser-only"), {});
  assert.equal(
    applicationAuditCommand("release"),
    "corepack pnpm verify:release",
  );
  for (const flag of [
    "--release",
    "--ai-browser-only",
    "--ai-quality",
    "--browser=firefox",
    "--grep=synced",
    "--api-only",
    "--postgres-only",
    "--skip-postgres",
    "--templates-only",
    "--advanced-only",
    "--startup-only",
    "--project=firefox-desktop",
    "--editor-browser-only",
  ]) {
    assert.throws(() => applicationAuditMode(["--editor-browser-only", flag]));
  }
  assert.throws(() =>
    applicationAuditMode(["--editor-browser-only", "--subnet=a", "--subnet=b"]),
  );
  assert.throws(() => applicationAuditEnvironment("unknown"));
});

test("native capture detects exact secrets across chunks and returns labels only", () => {
  const capture = cleanCapture();
  capture.append("api", canary.slice(0, 9), "stderr");
  capture.append("api", canary.slice(9), "stderr");
  const result = capture.scan(patterns);
  assert.equal(result.complete, true);
  assert.equal(result.passed, false);
  assert.deepEqual(result.counts, [{ label: "canary", count: 1 }]);
  noSecrets(result);
  capture.dispose();
});

test("a complete nonempty clean native scan passes with silent stderr", () => {
  const capture = cleanCapture();
  const result = capture.scan(patterns);
  assert.equal(result.passed, true);
  assert(result.bytesScanned > 0);
  assert.equal(result.bytesScanned, result.bytesObserved);
  assert.equal(result.sources.length, 2);
  noSecrets(result);
  capture.dispose();
});

test("zero, missing, unavailable and truncated sources fail closed", () => {
  const empty = createApplicationLogCapture();
  assert.equal(empty.scan(patterns).passed, false);
  empty.append("api", "ready");
  assert.equal(empty.scan(patterns).passed, false);
  empty.dispose();
  assert.equal(unavailableApplicationLogScan().passed, false);
  const truncated = createApplicationLogCapture({
    maxBytes: 8,
    sources: ["api"],
  });
  truncated.append("api", "0123456789");
  const result = truncated.scan(patterns);
  assert.equal(result.passed, false);
  assert.equal(result.complete, false);
  assert.equal(result.truncated, true);
  assert.equal(result.bytesObserved, 10);
  assert.equal(result.bytesScanned, 8);
  truncated.dispose();
});

test("scan result projection drops raw fields and rejects unsafe labels", () => {
  const capture = cleanCapture();
  const result = applicationLogScanResult({
    ...capture.scan(patterns),
    rawLogs: canary,
    error: canary,
  });
  assert.equal(result.passed, false);
  noSecrets(result);
  assert.equal(
    applicationLogScanResult({
      ...result,
      counts: [{ label: canary, count: 0 }],
    }).passed,
    false,
  );
  assert.throws(
    () => capture.scan([{ label: "canary", value: canary.repeat(500) }]),
    (error) => !error.message.includes(canary),
  );
  capture.dispose();
});

test("error metadata and inconsistent completeness cannot masquerade as a clean scan", () => {
  const capture = cleanCapture();
  const result = capture.scan(patterns);
  assert.equal(
    applicationLogScanResult({ ...result, reason: "unavailable" }).passed,
    false,
  );
  assert.equal(
    applicationLogScanResult({
      ...result,
      bytesScanned: result.bytesScanned + 1,
    }).passed,
    false,
  );
  capture.dispose();
  assert.equal(capture.scan(patterns).passed, false);
});

test("authenticated loopback scan detects both child canary and root exact secrets", async () => {
  const rootSecret = "synthetic-root-private-91458";
  const capture = cleanCapture();
  capture.append("api", canary + rootSecret);
  const service = await createApplicationLogScanService({
    scan: (input) =>
      capture.scan([...input, { label: "root-secret-1", value: rootSecret }]),
  });
  try {
    const result = await requestApplicationLogScan({ ...service, patterns });
    assert.equal(result.passed, false);
    assert.equal(result.complete, true);
    assert.deepEqual(
      result.counts.map((item) => item.count),
      [1, 1],
    );
    noSecrets(result, [canary, rootSecret, service.token]);
  } finally {
    await service.close();
    capture.dispose();
  }
});

test("loopback scan is clean only after an authorized complete response", async () => {
  const capture = cleanCapture();
  const service = await createApplicationLogScanService({
    scan: (input) => capture.scan(input),
    maxRequests: 3,
  });
  try {
    const denied = await fetch(service.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong",
      },
      body: JSON.stringify({ patterns }),
    });
    assert.equal(denied.status, 401);
    noSecrets(await denied.json(), [canary, service.token]);
    const result = await requestApplicationLogScan({ ...service, patterns });
    assert.equal(result.passed, true);
    noSecrets(result, [canary, service.token]);
  } finally {
    await service.close();
    capture.dispose();
  }
});

test("client rejects noncanonical URLs without reflecting their contents", async () => {
  for (const url of [
    "https://127.0.0.1:1234/application-log-scan",
    "http://localhost:1234/application-log-scan",
    "http://127.0.0.2:1234/application-log-scan",
    `http://user:${canary}@127.0.0.1:1234/application-log-scan`,
    `http://127.0.0.1:1234/application-log-scan?secret=${canary}`,
    `http://127.0.0.1:1234/application-log-scan#${canary}`,
  ]) {
    assert.throws(
      () => validateApplicationLogScanUrl(url),
      (error) => !error.message.includes(canary),
    );
    const result = await requestApplicationLogScan({
      url,
      token: "a".repeat(43),
      patterns,
    });
    assert.equal(result.passed, false);
    noSecrets(result);
  }
});

test("redirects and callback failures never expose secrets or become clean scans", async () => {
  let followedRedirects = 0;
  const target = createServer((_request, response) => {
    followedRedirects += 1;
    response.end("{}");
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const redirect = createServer((_request, response) => {
    response.writeHead(302, {
      location: `http://127.0.0.1:${target.address().port}/${canary}`,
    });
    response.end();
  });
  await new Promise((resolve) => redirect.listen(0, "127.0.0.1", resolve));
  try {
    const result = await requestApplicationLogScan({
      url: `http://127.0.0.1:${redirect.address().port}/application-log-scan`,
      token: "a".repeat(43),
      patterns,
    });
    assert.equal(result.passed, false);
    assert.equal(followedRedirects, 0);
    noSecrets(result);
  } finally {
    redirect.closeAllConnections();
    await new Promise((resolve) => redirect.close(resolve));
    target.closeAllConnections();
    await new Promise((resolve) => target.close(resolve));
  }
  const service = await createApplicationLogScanService({
    scan: () => {
      throw new Error(canary);
    },
  });
  try {
    const result = await requestApplicationLogScan({ ...service, patterns });
    assert.equal(result.passed, false);
    noSecrets(result);
  } finally {
    await service.close();
  }
});

test("request count and body limits fail closed without invoking the scanner", async () => {
  let scans = 0;
  const service = await createApplicationLogScanService({
    scan: () => {
      scans += 1;
    },
    maxRequests: 1,
  });
  try {
    const oversized = await fetch(service.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${service.token}`,
      },
      body: " ".repeat(64 * 1024) + JSON.stringify({ patterns }),
    }).catch(() => null);
    if (oversized) assert.equal(oversized.ok, false);
    const limited = await requestApplicationLogScan({ ...service, patterns });
    assert.equal(limited.passed, false);
    assert.equal(scans, 0);
    noSecrets(limited);
  } finally {
    await service.close();
  }
});

test("Docker fallback never invokes logs for an empty container and rejects unreadable logs", async () => {
  let calls = 0;
  const readLogs = async () => {
    calls += 1;
    return { stdout: "ready" };
  };
  const empty = await scanDockerApplicationLogs({
    resolveContainer: async () => "",
    readLogs,
    patterns,
  });
  assert.equal(empty.passed, false);
  assert.equal(calls, 0);
  const unavailable = await scanDockerApplicationLogs({
    resolveContainer: async () => "owned-fixture",
    readLogs: async () => {
      throw new Error(canary);
    },
    patterns,
  });
  assert.equal(unavailable.passed, false);
  noSecrets(unavailable);
  const zero = await scanDockerApplicationLogs({
    resolveContainer: async () => "owned-fixture",
    readLogs: async () => ({ stdout: "", stderr: "" }),
    patterns,
  });
  assert.equal(zero.passed, false);
  const clean = await scanDockerApplicationLogs({
    resolveContainer: async () => "owned-fixture",
    readLogs: async () => ({ stdout: "ready", stderr: "" }),
    patterns,
  });
  assert.equal(clean.passed, true);
  const errored = await scanDockerApplicationLogs({
    resolveContainer: async () => "owned-fixture",
    readLogs: async () => ({ stdout: "ready", error: canary }),
    patterns,
  });
  assert.equal(errored.passed, false);
  noSecrets(errored);
  const truncated = await scanDockerApplicationLogs({
    resolveContainer: async () => "owned-fixture",
    readLogs: async () => {
      const error = new Error(canary);
      error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      throw error;
    },
    patterns,
  });
  assert.equal(truncated.passed, false);
  assert.equal(truncated.truncated, true);
  noSecrets(truncated);
  const detected = await scanDockerApplicationLogs({
    resolveContainer: async () => "owned-fixture",
    readLogs: async () => ({ stdout: "ready", stderr: canary }),
    patterns,
  });
  assert.equal(detected.passed, false);
  assert.equal(detected.counts[0].count, 1);
  noSecrets(detected);
});
