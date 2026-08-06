import { readFile, unlink, writeFile } from "node:fs/promises";

const mode = process.argv[2];
if (!new Set(["prepare", "resume"]).has(mode)) {
  throw new Error("Usage: node ci-embedded-rag-sync-smoke.mjs prepare|resume");
}

const baseUrl = new URL(
  process.env.CI_SMOKE_BASE_URL ?? "http://127.0.0.1:3000",
);
const mockUrl = new URL(
  process.env.CI_RAG_SYNC_MOCK_URL ?? "http://127.0.0.1:18080",
);
const writerBaseUrl =
  process.env.CI_RAG_SYNC_WRITER_URL ?? "http://docmost-open-webui:8080";
const statePath =
  process.env.CI_RAG_SYNC_STATE_PATH ?? ".ci-rag-sync-smoke-state.json";
const email = "ci-admin@example.test";
const password = "CI-smoke-password-123!";
let cookie = "";
let csrfToken = "";

function fail(message) {
  throw new Error(`Embedded RAG sync smoke failed: ${message}`);
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
    fail("login did not return auth and CSRF cookies");
  }
}

async function login() {
  const response = await fetch(new URL("api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl.origin },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) fail(`login returned ${response.status}`);
  collectCookies(response);
  await readJson(response);
}

async function rawApi(path, { method = "GET", body } = {}) {
  const headers = {
    accept: "application/json",
    cookie,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
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
  return {
    status: response.status,
    ok: response.ok,
    payload: payload?.data ?? payload,
    rawPayload: payload,
  };
}

async function api(path, options) {
  const result = await rawApi(path, options);
  if (!result.ok) {
    fail(
      `${options?.method ?? "GET"} ${path} returned ${result.status}: ${JSON.stringify(result.rawPayload)}`,
    );
  }
  return result.payload;
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

async function createSpace(label) {
  const slug = `${label.toLowerCase()}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const result = await api("api/spaces", {
    method: "POST",
    body: { name: `RAG ${label}`, slug },
  });
  const space = findObject(
    result,
    (candidate) => candidate.id && candidate.slug === slug,
  );
  if (!space?.id) fail(`space ${label} response omitted its id`);
  return space;
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
  if (!page?.id) fail(`page ${title} response omitted its id`);
  return page;
}

async function mapConcurrent(values, concurrency, task) {
  const output = new Array(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await task(values[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return output;
}

async function mockState() {
  const response = await fetch(new URL("__state", mockUrl));
  if (!response.ok) fail(`mock state returned ${response.status}`);
  return readJson(response);
}

function docmostMetadata(file) {
  return file?.meta?.data?.docmost;
}

function filesForSpace(state, spaceId) {
  return state.files.filter(
    (file) => docmostMetadata(file)?.spaceId === spaceId,
  );
}

async function waitFor(description, predicate, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  fail(`${description} did not complete before the deadline${suffix}`);
}

async function prepare() {
  await login();
  const [spaceOne, spaceTwo] = await Promise.all([
    createSpace("One"),
    createSpace("Two"),
  ]);
  const pageCount = Number(process.env.CI_RAG_SYNC_PAGE_COUNT ?? 104);
  const pagesOne = await mapConcurrent(
    Array.from({ length: pageCount }),
    8,
    (_value, index) =>
      createPage(spaceOne.id, `rag-one-${String(index).padStart(3, "0")}`),
  );
  const pagesTwo = await mapConcurrent(["alpha", "beta"], 2, (suffix) =>
    createPage(spaceTwo.id, `rag-two-${suffix}`),
  );

  let configOne = await api(`api/spaces/${spaceOne.id}/ai/rag-sync`, {
    method: "PATCH",
    body: {
      expectedVersion: null,
      target: {
        baseUrl: writerBaseUrl,
        knowledgeId: "knowledge-one",
        writerApiKey: "ci-writer-one",
      },
    },
  });
  if (JSON.stringify(configOne).includes("ci-writer-one")) {
    fail("writer API key was returned by the space configuration API");
  }
  await api(`api/spaces/${spaceOne.id}/ai/rag-sync/actions/test`, {
    method: "POST",
  });
  configOne = await api(`api/spaces/${spaceOne.id}/ai/rag-sync`);
  await waitFor("target-test marker cleanup", async () => {
    const state = await mockState();
    return !state.files.some(
      (file) => docmostMetadata(file)?.marker === "target-test",
    );
  });

  const duplicate = await rawApi(`api/spaces/${spaceTwo.id}/ai/rag-sync`, {
    method: "PATCH",
    body: {
      expectedVersion: null,
      target: {
        baseUrl: writerBaseUrl,
        knowledgeId: "knowledge-one",
        writerApiKey: "ci-writer-two",
      },
    },
  });
  if (
    duplicate.status !== 409 ||
    !JSON.stringify(duplicate.rawPayload).includes("rag_sync_target_in_use")
  ) {
    fail("a Knowledge target could be claimed by two spaces");
  }

  let configTwo = await api(`api/spaces/${spaceTwo.id}/ai/rag-sync`, {
    method: "PATCH",
    body: {
      expectedVersion: null,
      target: {
        baseUrl: writerBaseUrl,
        knowledgeId: "knowledge-two",
        writerApiKey: "ci-writer-two",
      },
    },
  });
  await api(`api/spaces/${spaceTwo.id}/ai/rag-sync/actions/test`, {
    method: "POST",
  });
  configTwo = await api(`api/spaces/${spaceTwo.id}/ai/rag-sync`);
  configTwo = await api(`api/spaces/${spaceTwo.id}/ai/rag-sync`, {
    method: "PATCH",
    body: {
      expectedVersion: configTwo.configVersion,
      target: { writerApiKey: "ci-invalid-writer" },
    },
  });
  if (JSON.stringify(configTwo).includes("ci-invalid-writer")) {
    fail("rotated writer API key was returned by the space configuration API");
  }
  await Promise.all([
    api(`api/spaces/${spaceOne.id}/ai/rag-sync/actions/enable`, {
      method: "POST",
      body: { expectedVersion: configOne.configVersion },
    }),
    api(`api/spaces/${spaceTwo.id}/ai/rag-sync/actions/enable`, {
      method: "POST",
      body: { expectedVersion: configTwo.configVersion },
    }),
  ]);

  await waitFor("bad-key isolation and first import quantum", async () => {
    const [state, secondConfig] = await Promise.all([
      mockState(),
      api(`api/spaces/${spaceTwo.id}/ai/rag-sync`),
    ]);
    return (
      filesForSpace(state, spaceOne.id).length >= 4 &&
      filesForSpace(state, spaceTwo.id).length === 0 &&
      secondConfig.status.errorCode === "rag_sync_writer_unauthorized"
    );
  });

  await writeFile(
    statePath,
    JSON.stringify(
      {
        spaceOneId: spaceOne.id,
        spaceTwoId: spaceTwo.id,
        pageIdsOne: pagesOne.map((page) => page.id),
        pageIdsTwo: pagesTwo.map((page) => page.id),
      },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(
    `Prepared two RAG bindings with an active import of ${pageCount} source pages\n`,
  );
}

function assertExactlyOnce(files, expectedIds, label) {
  const counts = new Map();
  for (const file of files) {
    const sourceId = docmostMetadata(file)?.sourceId;
    if (sourceId) counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
  }
  for (const id of expectedIds) {
    if (counts.get(id) !== 1) {
      fail(`${label} source ${id} was not synchronized exactly once`);
    }
  }
}

async function resume() {
  const saved = JSON.parse(await readFile(statePath, "utf8"));
  await login();

  await waitFor("checkpoint resume after container restart", async () => {
    const state = await mockState();
    const files = filesForSpace(state, saved.spaceOneId);
    return saved.pageIdsOne.every((id) =>
      files.some((file) => docmostMetadata(file)?.sourceId === id),
    );
  });
  let state = await mockState();
  assertExactlyOnce(
    filesForSpace(state, saved.spaceOneId),
    saved.pageIdsOne,
    "first space",
  );

  const configTwo = await api(`api/spaces/${saved.spaceTwoId}/ai/rag-sync`);
  await api(`api/spaces/${saved.spaceTwoId}/ai/rag-sync`, {
    method: "PATCH",
    body: {
      expectedVersion: configTwo.configVersion,
      target: { writerApiKey: "ci-writer-two" },
    },
  });

  await waitFor("second space recovery after writer-key rotation", async () => {
    const [remote, firstConfig, secondConfig] = await Promise.all([
      mockState(),
      api(`api/spaces/${saved.spaceOneId}/ai/rag-sync`),
      api(`api/spaces/${saved.spaceTwoId}/ai/rag-sync`),
    ]);
    const secondFiles = filesForSpace(remote, saved.spaceTwoId);
    return (
      saved.pageIdsTwo.every((id) =>
        secondFiles.some((file) => docmostMetadata(file)?.sourceId === id),
      ) &&
      !remote.files.some(
        (file) => docmostMetadata(file)?.marker === "target-test",
      ) &&
      firstConfig.status.health === "healthy" &&
      secondConfig.status.health === "healthy"
    );
  });
  state = await mockState();
  if (state.duplicateOperationIds.length > 0) {
    fail(
      "multiple Docmost replicas uploaded the same operation more than once",
    );
  }
  assertExactlyOnce(
    filesForSpace(state, saved.spaceTwoId),
    saved.pageIdsTwo,
    "second space",
  );

  const [currentOne, currentTwo] = await Promise.all([
    api(`api/spaces/${saved.spaceOneId}/ai/rag-sync`),
    api(`api/spaces/${saved.spaceTwoId}/ai/rag-sync`),
  ]);
  await Promise.all([
    api(`api/spaces/${saved.spaceOneId}/ai/rag-sync/actions/disable`, {
      method: "POST",
      body: { expectedVersion: currentOne.configVersion },
    }),
    api(`api/spaces/${saved.spaceTwoId}/ai/rag-sync/actions/disable`, {
      method: "POST",
      body: { expectedVersion: currentTwo.configVersion },
    }),
  ]);

  await waitFor("managed cleanup", async () => {
    const [remote, firstConfig, secondConfig] = await Promise.all([
      mockState(),
      api(`api/spaces/${saved.spaceOneId}/ai/rag-sync`),
      api(`api/spaces/${saved.spaceTwoId}/ai/rag-sync`),
    ]);
    return (
      filesForSpace(remote, saved.spaceOneId).length === 0 &&
      filesForSpace(remote, saved.spaceTwoId).length === 0 &&
      remote.files.filter(
        (file) =>
          !docmostMetadata(file) &&
          ["knowledge-one", "knowledge-two"].includes(file.knowledgeId),
      ).length === 2 &&
      remote.duplicateOperationIds.length === 0 &&
      firstConfig.state === "disabled" &&
      secondConfig.state === "disabled" &&
      firstConfig.cleanupRequired === false &&
      secondConfig.cleanupRequired === false
    );
  });
  await unlink(statePath);
  process.stdout.write(
    "Embedded RAG sync resumed without duplicate operations and completed managed cleanup\n",
  );
}

if (mode === "prepare") await prepare();
if (mode === "resume") await resume();
