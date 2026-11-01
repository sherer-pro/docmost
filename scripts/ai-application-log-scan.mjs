import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_BODY = 64 * 1024;
const MAX_PATTERNS = 64;
const LABEL =
  /^(?:canary|auth-token|csrf-token|extra-\d{1,2}|root-secret-\d{1,2})$/;
const SOURCES = new Set(["api", "collaboration", "docker"]);
const REASONS = new Set([
  "unavailable",
  "empty",
  "truncated",
  "invalid-request",
  "invalid-response",
  "unauthorized",
  "request-limit",
]);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

export function applicationAuditMode(args) {
  const release = args.includes("--release");
  const diagnostic = args.includes("--ai-browser-only");
  if (!release && !diagnostic) return null;
  const flag = release ? "--release" : "--ai-browser-only";
  if (
    args.some((arg) => arg !== flag && !arg.startsWith("--subnet=")) ||
    (diagnostic &&
      (args.filter((arg) => arg === flag).length !== 1 ||
        args.filter((arg) => arg.startsWith("--subnet=")).length > 1))
  )
    throw new Error(
      release
        ? "Full release acceptance accepts only --release and an optional isolated --subnet"
        : "AI browser diagnostic accepts only --ai-browser-only and an optional isolated --subnet",
    );
  return release ? "release" : "ai-browser-only";
}

export function applicationAuditCommand(mode) {
  if (mode === "release") return "corepack pnpm verify:release";
  if (mode === "ai-browser-only") return "corepack pnpm test:ai:e2e";
  throw new Error("Invalid isolated application audit mode");
}

export function applicationLogErrorSummary(lines, redact) {
  return redact(lines.join("\n"));
}

function patternsOnly(patterns) {
  if (
    !Array.isArray(patterns) ||
    !patterns.length ||
    patterns.length > MAX_PATTERNS
  )
    throw new Error("Invalid application log scan patterns");
  const seen = new Set();
  let bytes = 0;
  return patterns.map((pattern) => {
    if (
      !pattern ||
      !LABEL.test(pattern.label) ||
      seen.has(pattern.label) ||
      typeof pattern.value !== "string" ||
      !pattern.value ||
      Buffer.byteLength(pattern.value) > 4096
    )
      throw new Error("Invalid application log scan patterns");
    bytes += Buffer.byteLength(pattern.value);
    if (bytes > MAX_BODY / 2)
      throw new Error("Invalid application log scan patterns");
    seen.add(pattern.label);
    return { label: pattern.label, value: pattern.value };
  });
}

export function unavailableApplicationLogScan(reason = "unavailable") {
  return {
    schemaVersion: 1,
    available: false,
    complete: false,
    truncated: reason === "truncated",
    bytesScanned: 0,
    bytesObserved: 0,
    sources: [],
    counts: [],
    reason: REASONS.has(reason) ? reason : "unavailable",
    clean: false,
    passed: false,
  };
}

// Project a result explicitly: raw logs, secret values and exception messages never cross this boundary.
export function applicationLogScanResult(value) {
  if (
    !value ||
    typeof value.available !== "boolean" ||
    typeof value.complete !== "boolean" ||
    typeof value.truncated !== "boolean" ||
    !integer(value.bytesScanned) ||
    !integer(value.bytesObserved) ||
    value.bytesObserved < value.bytesScanned ||
    !Array.isArray(value.sources) ||
    value.sources.length > 3 ||
    !Array.isArray(value.counts) ||
    value.counts.length > MAX_PATTERNS
  )
    return unavailableApplicationLogScan("invalid-response");
  const sources = [];
  for (const item of value.sources) {
    if (
      !item ||
      !SOURCES.has(item.label) ||
      !integer(item.bytesScanned) ||
      !integer(item.bytesObserved) ||
      item.bytesObserved < item.bytesScanned ||
      typeof item.complete !== "boolean" ||
      typeof item.truncated !== "boolean"
    )
      return unavailableApplicationLogScan("invalid-response");
    sources.push({
      label: item.label,
      bytesScanned: item.bytesScanned,
      bytesObserved: item.bytesObserved,
      complete: item.complete,
      truncated: item.truncated,
    });
  }
  const counts = [];
  for (const item of value.counts) {
    if (!item || !LABEL.test(item.label) || !integer(item.count))
      return unavailableApplicationLogScan("invalid-response");
    counts.push({ label: item.label, count: item.count });
  }
  if (
    new Set(sources.map((item) => item.label)).size !== sources.length ||
    new Set(counts.map((item) => item.label)).size !== counts.length ||
    sources.reduce((sum, item) => sum + item.bytesScanned, 0) !==
      value.bytesScanned ||
    sources.reduce((sum, item) => sum + item.bytesObserved, 0) !==
      value.bytesObserved
  )
    return unavailableApplicationLogScan("invalid-response");
  const reason = value.error
    ? "unavailable"
    : REASONS.has(value.reason)
      ? value.reason
      : null;
  const complete =
    value.complete &&
    !value.truncated &&
    value.bytesObserved === value.bytesScanned &&
    sources.length > 0 &&
    sources.every(
      (item) =>
        item.complete &&
        !item.truncated &&
        item.bytesScanned > 0 &&
        item.bytesObserved === item.bytesScanned,
    );
  const clean =
    value.available &&
    reason === null &&
    complete &&
    value.bytesScanned > 0 &&
    counts.length > 0 &&
    counts.every((item) => item.count === 0);
  return {
    schemaVersion: 1,
    available: value.available,
    complete,
    truncated: value.truncated,
    bytesScanned: value.bytesScanned,
    bytesObserved: value.bytesObserved,
    sources,
    counts,
    reason,
    clean,
    passed: clean,
  };
}

export function nativeApplicationLogScanResult(value) {
  const result = applicationLogScanResult(value);
  const labels = result.sources.map((source) => source.label);
  if (
    labels.length !== 2 ||
    !labels.includes("api") ||
    !labels.includes("collaboration")
  )
    return unavailableApplicationLogScan("invalid-response");
  return result;
}

export function createApplicationLogCapture({
  maxBytes = MAX_BYTES,
  sources = ["api", "collaboration"],
} = {}) {
  if (
    !integer(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES ||
    !sources.length ||
    sources.some((source) => !SOURCES.has(source)) ||
    new Set(sources).size !== sources.length
  )
    throw new Error("Invalid application log capture limits");
  const entries = new Map(
    sources.map((label) => [
      label,
      {
        observed: 0,
        retained: 0,
        truncated: false,
        streams: { stdout: [], stderr: [] },
      },
    ]),
  );
  let retained = 0;
  let disposed = false;
  return {
    append(label, data, stream = "stdout") {
      if (disposed) return;
      const entry = entries.get(label);
      if (!entry || !["stdout", "stderr"].includes(stream))
        throw new Error("Invalid application log source");
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      entry.observed += chunk.length;
      const keep = Math.min(chunk.length, maxBytes - retained);
      if (keep)
        entry.streams[stream].push(Buffer.from(chunk.subarray(0, keep)));
      entry.retained += keep;
      retained += keep;
      if (keep < chunk.length) entry.truncated = true;
    },
    scan(input) {
      if (disposed) return unavailableApplicationLogScan();
      const patterns = patternsOnly(input);
      const counts = patterns.map(({ label }) => ({ label, count: 0 }));
      const metadata = [];
      for (const [label, entry] of entries) {
        for (const chunks of Object.values(entry.streams)) {
          const bytes = Buffer.concat(chunks);
          patterns.forEach((pattern, index) => {
            const needle = Buffer.from(pattern.value);
            let offset = 0;
            while ((offset = bytes.indexOf(needle, offset)) !== -1) {
              counts[index].count += 1;
              offset += needle.length;
            }
          });
        }
        metadata.push({
          label,
          bytesScanned: entry.retained,
          bytesObserved: entry.observed,
          complete: entry.observed > 0 && !entry.truncated,
          truncated: entry.truncated,
        });
      }
      return applicationLogScanResult({
        available: true,
        complete: metadata.every((item) => item.complete),
        truncated: metadata.some((item) => item.truncated),
        bytesScanned: retained,
        bytesObserved: metadata.reduce(
          (sum, item) => sum + item.bytesObserved,
          0,
        ),
        sources: metadata,
        counts,
        reason: metadata.some((item) => item.truncated)
          ? "truncated"
          : metadata.some((item) => !item.bytesScanned)
            ? "empty"
            : null,
      });
    },
    dispose() {
      disposed = true;
      for (const entry of entries.values()) {
        for (const chunks of Object.values(entry.streams)) {
          chunks.forEach((chunk) => chunk.fill(0));
          chunks.length = 0;
        }
      }
    },
  };
}

export function validateApplicationLogScanUrl(value) {
  if (
    typeof value !== "string" ||
    !/^http:\/\/127\.0\.0\.1:\d{1,5}\/application-log-scan$/.test(value)
  )
    throw new Error("Invalid application log scan URL");
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.port ||
    Number(url.port) > 65535
  )
    throw new Error("Invalid application log scan URL");
  return url.href;
}

async function limitedBody(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Application log scan body limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function createApplicationLogScanService({
  scan,
  maxRequests = 16,
}) {
  if (
    typeof scan !== "function" ||
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 32
  )
    throw new Error("Invalid application log scan service");
  const token = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(token).digest();
  let requests = 0;
  let busy = false;
  const server = createServer(
    { maxHeaderSize: 4096 },
    async (request, response) => {
      const send = (status, result) => {
        response.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify(result));
      };
      requests += 1;
      const header = String(request.headers.authorization ?? "");
      const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
      const authorized = timingSafeEqual(
        digest,
        createHash("sha256").update(supplied).digest(),
      );
      if (!authorized)
        return send(401, unavailableApplicationLogScan("unauthorized"));
      if (requests > maxRequests || busy)
        return send(429, unavailableApplicationLogScan("request-limit"));
      if (
        request.method !== "POST" ||
        request.url !== "/application-log-scan" ||
        request.headers["content-type"] !== "application/json"
      )
        return send(400, unavailableApplicationLogScan("invalid-request"));
      busy = true;
      try {
        const input = JSON.parse(await limitedBody(request));
        if (Object.keys(input).some((key) => key !== "patterns"))
          throw new Error("Invalid scan request");
        const patterns = patternsOnly(input.patterns);
        send(200, applicationLogScanResult(await scan(patterns)));
      } catch {
        send(400, unavailableApplicationLogScan("invalid-request"));
      } finally {
        busy = false;
      }
    },
  );
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 4;
  server.maxRequestsPerSocket = maxRequests;
  server.on("clientError", (_error, socket) =>
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"),
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/application-log-scan`,
    token,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export async function requestApplicationLogScan({ url, token, patterns }) {
  let target;
  try {
    target = validateApplicationLogScanUrl(url);
    patterns = patternsOnly(patterns);
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error("Invalid scan token");
  } catch {
    return unavailableApplicationLogScan("invalid-request");
  }
  try {
    const response = await fetch(target, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ patterns }),
    });
    if (!response.ok || !response.body)
      return unavailableApplicationLogScan("unavailable");
    const result = nativeApplicationLogScanResult(
      JSON.parse(await limitedBody(response.body)),
    );
    if (
      patterns.some(
        ({ label }) => !result.counts.some((item) => item.label === label),
      )
    )
      return unavailableApplicationLogScan("invalid-response");
    return result;
  } catch {
    return unavailableApplicationLogScan("unavailable");
  }
}

export async function scanDockerApplicationLogs({
  resolveContainer,
  readLogs,
  patterns,
}) {
  let capture;
  try {
    const container = String(await resolveContainer()).trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container))
      return unavailableApplicationLogScan();
    const logs = await readLogs(container);
    if (logs.error || logs.truncated)
      return unavailableApplicationLogScan(
        logs.truncated ? "truncated" : "unavailable",
      );
    capture = createApplicationLogCapture({ sources: ["docker"] });
    capture.append("docker", logs.stdout ?? "", "stdout");
    capture.append("docker", logs.stderr ?? "", "stderr");
    return capture.scan(patterns);
  } catch (error) {
    return unavailableApplicationLogScan(
      error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ? "truncated"
        : "unavailable",
    );
  } finally {
    capture?.dispose();
  }
}
