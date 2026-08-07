import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const port = 20_000 + Math.floor(Math.random() * 10_000);
const baseUrl = `http://127.0.0.1:${port}`;
let child;

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Open WebUI fixture did not become healthy");
}

async function control(command) {
  const response = await fetch(`${baseUrl}/__control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  assert.equal(response.status, 200);
}

function writerHeaders() {
  return { authorization: "Bearer ci-writer-one" };
}

async function upload(
  index,
  {
    fileName = `file-${index}.md`,
    contentType = "text/markdown",
    content = `contract fixture ${index}`,
  } = {},
) {
  const sourceId = randomUUID();
  const operationId = `contract-operation-${String(index).padStart(2, "0")}`;
  const metadata = {
    knowledge_id: "knowledge-one",
    docmost: {
      schemaVersion: 2,
      bindingId: "contract-binding",
      targetVersion: 1,
      workspaceId: randomUUID(),
      spaceId: randomUUID(),
      sourceType: "page",
      sourceId,
      pageId: sourceId,
      sourceUpdatedAtMs: Date.now(),
      contentHash: index.toString(16).padStart(64, "0"),
      operationId,
    },
  };
  const form = new FormData();
  form.set("file", new Blob([content], { type: contentType }), fileName);
  form.set("metadata", JSON.stringify(metadata));
  const response = await fetch(`${baseUrl}/api/v1/files/`, {
    method: "POST",
    headers: writerHeaders(),
    body: form,
  });
  assert.equal(response.status, 200);
  return { ...(await response.json()), metadata };
}

before(async () => {
  child = spawn(process.execPath, ["scripts/ci-open-webui-mock.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOCK_OPEN_WEBUI_HOST: "127.0.0.1",
      MOCK_OPEN_WEBUI_PORT: String(port),
      MOCK_OPEN_WEBUI_PROCESSING_DELAY_MS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
});

test("implements fixed Knowledge pagination, retrieval hydration and operation accounting", async () => {
  const uploaded = [];
  for (let index = 0; index < 35; index += 1) {
    uploaded.push(await upload(index));
  }
  const first = await fetch(
    `${baseUrl}/api/v1/knowledge/knowledge-one/files?page=1&limit=500`,
    { headers: writerHeaders() },
  ).then((response) => response.json());
  const second = await fetch(
    `${baseUrl}/api/v1/knowledge/knowledge-one/files?page=2&limit=500`,
    { headers: writerHeaders() },
  ).then((response) => response.json());
  assert.equal(first.items.length, 30);
  assert.equal(second.items.length, 6);
  assert.equal(first.total, 36);

  const retrieval = await fetch(
    `${baseUrl}/api/v1/retrieval/query/collection`,
    {
      method: "POST",
      headers: { ...writerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        collection_names: ["knowledge-one"],
        query: "fixture",
        k: 40,
      }),
    },
  ).then((response) => response.json());
  assert.equal(retrieval.documents[0].length, 35);
  assert.ok(retrieval.metadatas[0].some((value) => value.file_id));
  assert.ok(retrieval.metadatas[0].some((value) => value.docmost));

  const state = await fetch(`${baseUrl}/__state`).then((response) =>
    response.json(),
  );
  assert.equal(state.duplicateOperationIds.length, 0);
  assert.equal(state.operationRequests[uploaded[0].metadata.docmost.operationId], 1);
});

test("preserves PDF and DOCX attachment identity, MIME and content hash", async () => {
  const pdf = await upload(101, {
    fileName: "contract-sentinel.pdf",
    contentType: "application/pdf",
    content: "%PDF-1.4\n% deterministic contract sentinel\n%%EOF\n",
  });
  const docx = await upload(102, {
    fileName: "contract-sentinel.docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    content: "deterministic DOCX contract sentinel",
  });
  const state = await fetch(`${baseUrl}/__state`).then((response) =>
    response.json(),
  );
  const pdfState = state.files.find((file) => file.id === pdf.id);
  const docxState = state.files.find((file) => file.id === docx.id);
  assert.equal(pdfState.filename, "contract-sentinel.pdf");
  assert.equal(pdfState.meta.content_type, "application/pdf");
  assert.equal(pdfState.meta.data.docmost.contentHash, "65".padStart(64, "0"));
  assert.equal(docxState.filename, "contract-sentinel.docx");
  assert.equal(
    docxState.meta.content_type,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(docxState.meta.data.docmost.contentHash, "66".padStart(64, "0"));
});

test("programs 429, malformed JSON, disconnect and abort-observable timeout", async () => {
  await control({
    fault: { operation: "list", mode: "status", status: 429, count: 1 },
  });
  let response = await fetch(
    `${baseUrl}/api/v1/knowledge/knowledge-one/files?page=1`,
    { headers: writerHeaders() },
  );
  assert.equal(response.status, 429);

  await control({
    fault: { operation: "list", mode: "status", status: 500, count: 1 },
  });
  response = await fetch(
    `${baseUrl}/api/v1/knowledge/knowledge-one/files?page=1`,
    { headers: writerHeaders() },
  );
  assert.equal(response.status, 500);

  await control({ fault: { operation: "list", mode: "malformed", count: 1 } });
  response = await fetch(
    `${baseUrl}/api/v1/knowledge/knowledge-one/files?page=1`,
    { headers: writerHeaders() },
  );
  await assert.rejects(() => response.json());

  await control({ fault: { operation: "list", mode: "disconnect", count: 1 } });
  await assert.rejects(() =>
    fetch(`${baseUrl}/api/v1/knowledge/knowledge-one/files?page=1`, {
      headers: writerHeaders(),
    }),
  );

  await control({
    fault: {
      operation: "list",
      mode: "timeout",
      timeoutMs: 5_000,
      count: 1,
    },
  });
  await assert.rejects(() =>
    fetch(`${baseUrl}/api/v1/knowledge/knowledge-one/files?page=1`, {
      headers: writerHeaders(),
      signal: AbortSignal.timeout(50),
    }),
  );

  await control({ fault: { operation: "retrieval", mode: "malformed", count: 1 } });
  response = await fetch(`${baseUrl}/api/v1/retrieval/query/collection`, {
    method: "POST",
    headers: { ...writerHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ collection_names: ["knowledge-one"], query: "x", k: 2 }),
  });
  await assert.rejects(() => response.json());
});
