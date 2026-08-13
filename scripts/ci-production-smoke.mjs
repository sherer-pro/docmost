import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { readFile } from "node:fs/promises";
import * as Y from "yjs";

const packageVersion = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
).version;

const baseUrl = new URL(
  process.env.CI_SMOKE_BASE_URL ?? "http://127.0.0.1:3000",
);
const collabUrl = process.env.CI_SMOKE_COLLAB_URL ?? "http://127.0.0.1:3001";
const collabEndpoint = new URL("/collab", collabUrl);
collabEndpoint.protocol = collabEndpoint.protocol === "https:" ? "wss:" : "ws:";
const marker = `ci-${Date.now()}-${crypto.randomUUID()}`;
let cookie = "";
let csrfToken = "";

function fail(message) {
  throw new Error(`Production smoke failed: ${message}`);
}

async function assertDedicatedCollaborationBoundary() {
  const apiCollabUrl = new URL("/collab", baseUrl);
  apiCollabUrl.protocol = apiCollabUrl.protocol === "https:" ? "wss:" : "ws:";

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(apiCollabUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("API collaboration boundary check timed out"));
    }, 5_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error("API unexpectedly accepted a /collab WebSocket"));
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  const unauthenticatedInternal = await fetch(
    new URL("/api/internal/collaboration/commands", collabUrl),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (unauthenticatedInternal.status !== 401) {
    fail(
      `unauthenticated internal collaboration command returned ${unauthenticatedInternal.status}`,
    );
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    fail(`non-JSON response from ${response.url}`);
  }
}

async function api(path, { method = "GET", body, authenticated = true } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (authenticated) headers.cookie = cookie;
  if (authenticated && method !== "GET" && method !== "HEAD") {
    headers.origin = baseUrl.origin;
    headers["x-csrf-token"] = csrfToken;
  }
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    fail(`${method} ${path} returned ${response.status}`);
  }
  return payload?.data ?? payload;
}

function collectCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const fallback = response.headers.get("set-cookie");
  const raw =
    values.length > 0 ? values : fallback ? fallback.split(/,(?=\s*\w+=)/) : [];
  const pairs = raw.map((value) => value.split(";", 1)[0]);
  cookie = pairs.join("; ");
  csrfToken =
    pairs
      .find((value) => value.startsWith("csrfToken="))
      ?.slice("csrfToken=".length) ?? "";
  if (!cookie.includes("authToken=") || !csrfToken) {
    fail("setup did not return auth and CSRF cookies");
  }
}

function findObject(value, predicate) {
  if (value && typeof value === "object") {
    if (predicate(value)) return value;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const found = findObject(child, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

async function setup() {
  const response = await fetch(new URL("api/auth/setup", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl.origin },
    body: JSON.stringify({
      name: "CI Admin",
      email: "ci-admin@example.test",
      password: "CI-smoke-password-123!",
      workspaceName: "CI Workspace",
      hostname: `ci${Date.now()}`,
    }),
  });
  if (!response.ok) fail(`workspace setup returned ${response.status}`);
  collectCookies(response);
  await readJson(response);
}

async function createPage(spaceId, title) {
  const result = await api("api/pages", {
    method: "POST",
    body: {
      spaceId,
      title,
      format: "json",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: crypto.randomUUID() },
            content: [{ type: "text", text: title }],
          },
        ],
      },
    },
  });
  const page = findObject(
    result,
    (candidate) => candidate.id && candidate.spaceId === spaceId,
  );
  if (!page?.id) fail("page creation response omitted the page id");
  return page;
}

async function callMcp(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) fail(`MCP tool ${name} returned an error`);
  return JSON.stringify(response.content);
}

function waitForProviderSync(provider, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("collaboration sync timed out")),
      timeoutMs,
    );
    provider.on("synced", ({ state }) => {
      if (!state) return;
      clearTimeout(timeout);
      resolve();
    });
    provider.on("authenticationFailed", () => {
      clearTimeout(timeout);
      reject(new Error("collaboration authentication failed"));
    });
  });
}

async function waitForPersistedContent(pageId, expected, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await api(
      `api/pages/info?pageId=${encodeURIComponent(pageId)}`,
    );
    if (JSON.stringify(page).includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  fail("collaboration update was not persisted before the deadline");
}

async function collaborationSmoke(pageId) {
  const tokenResult = await api(
    `api/auth/collab-token?pageId=${encodeURIComponent(pageId)}`,
  );
  const token =
    findObject(tokenResult, (candidate) => typeof candidate.token === "string")
      ?.token ?? tokenResult?.token;
  if (!token) fail("collaboration token response omitted token");

  const document = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: collabEndpoint.toString(),
    name: `page.${pageId}`,
    document,
    token,
  });
  await waitForProviderSync(provider);
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.setAttribute("id", crypto.randomUUID());
  const text = new Y.XmlText();
  text.insert(0, marker);
  paragraph.insert(0, [text]);
  document
    .getXmlFragment("default")
    .insert(document.getXmlFragment("default").length, [paragraph]);
  await new Promise((resolve) => setTimeout(resolve, 250));
  provider.destroy();
  await waitForPersistedContent(pageId, marker);

  const reloaded = new Y.Doc();
  const reconnect = new HocuspocusProvider({
    url: collabEndpoint.toString(),
    name: `page.${pageId}`,
    document: reloaded,
    token,
  });
  await waitForProviderSync(reconnect);
  if (!reloaded.getXmlFragment("default").toString().includes(marker)) {
    reconnect.destroy();
    fail("reconnect did not load the committed collaboration update");
  }
  reconnect.destroy();
}

await assertDedicatedCollaborationBoundary();
await setup();
const spaces = await api("api/spaces");
const primarySpace = findObject(
  spaces,
  (candidate) => candidate.id && candidate.slug,
);
if (!primarySpace?.id) fail("default space was not created");

const visiblePage = await createPage(primarySpace.id, `visible-${marker}`);
const excludedPage = await createPage(primarySpace.id, `excluded-${marker}`);
const policy = await api(`api/spaces/${primarySpace.id}/ai/exclusions`);
const revision = Number(policy?.revision ?? 0);
await api(`api/spaces/${primarySpace.id}/ai/exclusions`, {
  method: "PUT",
  body: {
    expectedRevision: revision,
    exclusions: [{ pageId: excludedPage.id, includeDescendants: true }],
  },
});

const otherSpace = await api("api/spaces", {
  method: "POST",
  body: { name: "Other CI Space", slug: `other${Date.now()}` },
});
const otherPage = await createPage(otherSpace.id, `other-${marker}`);

const keyResult = await api("api/api-keys/create", {
  method: "POST",
  body: {
    name: "CI MCP",
    spaceId: primarySpace.id,
    keyType: "mcp",
    allowedCapabilities: ["search.query", "page.tree.read"],
  },
});
const apiToken = keyResult?.token;
if (!apiToken) fail("MCP API key response omitted token");

const unauthorized = await fetch(new URL("mcp", baseUrl), {
  method: "POST",
  headers: {
    authorization: "Bearer invalid",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
if (![401, 403, 404].includes(unauthorized.status)) {
  fail(`invalid MCP key returned ${unauthorized.status}`);
}

const client = new Client({ name: "docmost-ci", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("mcp", baseUrl), {
    requestInit: { headers: { authorization: `Bearer ${apiToken}` } },
  }),
);
try {
  const serverInfo = client.getServerVersion();
  if (serverInfo?.version !== packageVersion) {
    fail(
      `MCP server version ${serverInfo?.version ?? "missing"} does not match package version ${packageVersion}`,
    );
  }
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  if (!names.has("getTree") || !names.has("search")) {
    fail("MCP tools/list omitted required read tools");
  }
  const tree = await callMcp(client, "getTree");
  if (!tree.includes(visiblePage.id)) fail("MCP tree omitted a visible page");
  if (tree.includes(excludedPage.id)) fail("MCP tree exposed an excluded page");
  if (tree.includes(otherPage.id)) fail("MCP key crossed its space boundary");
  const excludedSearch = await callMcp(client, "search", {
    query: `excluded-${marker}`,
  });
  if (excludedSearch.includes(excludedPage.id)) {
    fail("MCP search exposed an excluded page");
  }
  const otherSearch = await callMcp(client, "search", {
    query: `other-${marker}`,
  });
  if (otherSearch.includes(otherPage.id)) {
    fail("MCP search crossed its space boundary");
  }
} finally {
  await client.close();
}

await collaborationSmoke(visiblePage.id);
