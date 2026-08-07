import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const host = process.env.MOCK_OPEN_WEBUI_HOST ?? "0.0.0.0";
const port = Number(process.env.MOCK_OPEN_WEBUI_PORT ?? 8080);
const processingDelayMs = Number(
  process.env.MOCK_OPEN_WEBUI_PROCESSING_DELAY_MS ?? 500,
);
const credentials = new Map([
  ["ci-writer-one", "knowledge-one"],
  ["ci-writer-two", "knowledge-two"],
]);
const files = new Map();
const counters = {
  uploads: 0,
  deletes: 0,
  unauthorized: 0,
  retrievals: 0,
  clientAborts: 0,
  providerRequests: 0,
};
const operationUploads = new Map();
const operationRequests = new Map();
const faults = new Map();
const KNOWLEDGE_PAGE_SIZE = 30;

for (const knowledgeId of ["knowledge-one", "knowledge-two"]) {
  const id = `foreign-${knowledgeId}`;
  files.set(id, {
    id,
    knowledgeId,
    fileName: `${id}.txt`,
    docmost: null,
    createdAt: 0,
  });
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendMalformed(response, status = 200) {
  const body = '{"malformed":';
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyFault(operation, request, response) {
  const configured = faults.get(operation);
  if (!configured || configured.remaining <= 0) return false;
  configured.remaining -= 1;
  if (configured.remaining === 0) faults.delete(operation);
  if (configured.delayMs > 0) await delay(configured.delayMs);
  if (request.aborted || response.destroyed) return true;
  if (configured.mode === "disconnect") {
    response.destroy();
    return true;
  }
  if (configured.mode === "malformed") {
    sendMalformed(response, configured.status ?? 200);
    return true;
  }
  if (configured.mode === "status") {
    send(response, configured.status ?? 500, { detail: "programmed fault" });
    return true;
  }
  if (configured.mode === "timeout") {
    await delay(configured.timeoutMs ?? 60_000);
    if (!request.aborted && !response.destroyed) {
      send(response, 504, { detail: "programmed timeout" });
    }
    return true;
  }
  return false;
}

function bearerToken(request) {
  const value = request.headers.authorization ?? "";
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : "";
}

function authorize(request, response, knowledgeId) {
  const permittedKnowledge = credentials.get(bearerToken(request));
  if (!permittedKnowledge) {
    counters.unauthorized += 1;
    send(response, 401, { detail: "invalid writer key" });
    return false;
  }
  if (knowledgeId && permittedKnowledge !== knowledgeId) {
    send(response, 403, { detail: "writer key cannot access this knowledge" });
    return false;
  }
  return true;
}

async function readBody(request, maxBytes = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function parseUpload(body) {
  const text = body.toString("utf8");
  const metadataMatch = text.match(
    /name="metadata"\r\n(?:Content-Type:[^\r]+\r\n)?\r\n([\s\S]*?)\r\n--/,
  );
  if (!metadataMatch) throw new Error("multipart metadata is missing");
  const fileNameMatch = text.match(/filename="([^"]+)"/);
  const contentTypeMatch = text.match(
    /filename="[^"]+"\r\nContent-Type:\s*([^\r\n]+)/i,
  );
  return {
    metadata: JSON.parse(metadataMatch[1]),
    fileName: fileNameMatch?.[1] ?? "unknown",
    contentType: contentTypeMatch?.[1]?.trim() ?? "application/octet-stream",
  };
}

function publicFile(file) {
  return {
    id: file.id,
    filename: file.fileName,
    meta: {
      content_type: file.contentType,
      data: { docmost: file.docmost },
    },
  };
}

function statePayload() {
  return {
    counters,
    faults: Object.fromEntries(faults),
    operationRequests: Object.fromEntries(operationRequests),
    duplicateOperationIds: [...operationUploads]
      .filter(([, count]) => count > 1)
      .map(([operationId]) => operationId),
    files: [...files.values()].map((file) => ({
      ...publicFile(file),
      knowledgeId: file.knowledgeId,
      status:
        Date.now() - file.createdAt >= processingDelayMs
          ? "completed"
          : "processing",
    })),
  };
}

const server = createServer(async (request, response) => {
  try {
    request.on("aborted", () => {
      counters.clientAborts += 1;
    });
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__state") {
      send(response, 200, statePayload());
      return;
    }
    if (request.method === "POST" && url.pathname === "/__control") {
      const command = JSON.parse((await readBody(request, 64 * 1024)).toString("utf8"));
      if (command.reset === true) {
        faults.clear();
      }
      if (command.fault) {
        const fault = command.fault;
        if (typeof fault.operation !== "string") {
          send(response, 400, { detail: "fault.operation is required" });
          return;
        }
        faults.set(fault.operation, {
          mode: String(fault.mode ?? "status"),
          status: Number(fault.status ?? 500),
          remaining: Math.max(1, Number(fault.count ?? 1)),
          delayMs: Math.max(0, Number(fault.delayMs ?? 0)),
          timeoutMs: Math.max(1, Number(fault.timeoutMs ?? 60_000)),
        });
      }
      if (command.revokeKey) credentials.delete(String(command.revokeKey));
      if (command.setKey?.token && command.setKey?.knowledgeId) {
        credentials.set(String(command.setKey.token), String(command.setKey.knowledgeId));
      }
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/version") {
      send(response, 200, { version: "0.11.0-fixture" });
      return;
    }
    if (
      request.method === "POST" &&
      (url.pathname === "/v1/chat/completions" ||
        url.pathname === "/chat/completions")
    ) {
      counters.providerRequests += 1;
      if (await applyFault("provider", request, response)) return;
      const body = JSON.parse((await readBody(request, 4 * 1024 * 1024)).toString("utf8"));
      const content = "Fixture answer supported by the synchronized source [S2]";
      if (body.stream === true) {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(
          `data: ${JSON.stringify({ id: randomUUID(), choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({ id: randomUUID(), choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } })}\n\n`,
        );
        response.end("data: [DONE]\n\n");
      } else {
        send(response, 200, {
          id: randomUUID(),
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        });
      }
      return;
    }

    const knowledgeInfoMatch = url.pathname.match(
      /^\/api\/v1\/knowledge\/([A-Za-z0-9_-]+)$/,
    );
    if (request.method === "GET" && knowledgeInfoMatch) {
      const knowledgeId = knowledgeInfoMatch[1];
      if (!authorize(request, response, knowledgeId)) return;
      if (await applyFault("knowledge", request, response)) return;
      send(response, 200, { id: knowledgeId, name: knowledgeId });
      return;
    }

    const knowledgeMatch = url.pathname.match(
      /^\/api\/v1\/knowledge\/([A-Za-z0-9_-]+)\/files$/,
    );
    if (request.method === "GET" && knowledgeMatch) {
      const knowledgeId = knowledgeMatch[1];
      if (!authorize(request, response, knowledgeId)) return;
      if (await applyFault("list", request, response)) return;
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const limit = KNOWLEDGE_PAGE_SIZE;
      const allItems = [...files.values()]
        .filter((file) => file.knowledgeId === knowledgeId)
        .map(publicFile);
      const offset = (page - 1) * limit;
      send(response, 200, {
        items: allItems.slice(offset, offset + limit),
        total: allItems.length,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/files/") {
      if (await applyFault("upload", request, response)) return;
      const body = await readBody(request);
      const { metadata, fileName, contentType } = parseUpload(body);
      const knowledgeId = String(metadata.knowledge_id ?? "");
      if (!authorize(request, response, knowledgeId)) return;
      if (!knowledgeId || !metadata.docmost) {
        send(response, 400, { detail: "knowledge metadata is required" });
        return;
      }
      const id = randomUUID();
      files.set(id, {
        id,
        knowledgeId,
        fileName,
        contentType,
        docmost: metadata.docmost,
        createdAt: Date.now(),
      });
      const operationId = String(metadata.docmost.operationId ?? "");
      if (operationId) {
        operationUploads.set(
          operationId,
          (operationUploads.get(operationId) ?? 0) + 1,
        );
        operationRequests.set(
          operationId,
          (operationRequests.get(operationId) ?? 0) + 1,
        );
      }
      counters.uploads += 1;
      send(response, 200, publicFile(files.get(id)));
      return;
    }

    const statusMatch = url.pathname.match(
      /^\/api\/v1\/files\/([A-Za-z0-9_-]+)\/process\/status$/,
    );
    if (request.method === "GET" && statusMatch) {
      const file = files.get(statusMatch[1]);
      if (!file) {
        send(response, 404, { status: "not_found" });
        return;
      }
      if (!authorize(request, response, file.knowledgeId)) return;
      if (await applyFault("poll", request, response)) return;
      send(response, 200, {
        status:
          Date.now() - file.createdAt >= processingDelayMs
            ? "completed"
            : "processing",
      });
      return;
    }

    const fileMatch = url.pathname.match(
      /^\/api\/v1\/files\/([A-Za-z0-9_-]+)$/,
    );
    if (request.method === "GET" && fileMatch) {
      const file = files.get(fileMatch[1]);
      if (!file) {
        send(response, 404, { detail: "file not found" });
        return;
      }
      if (!authorize(request, response, file.knowledgeId)) return;
      if (await applyFault("file", request, response)) return;
      send(response, 200, publicFile(file));
      return;
    }
    if (request.method === "DELETE" && fileMatch) {
      const file = files.get(fileMatch[1]);
      if (!file) {
        send(response, 404, { detail: "file not found" });
        return;
      }
      if (!authorize(request, response, file.knowledgeId)) return;
      if (await applyFault("delete", request, response)) return;
      files.delete(file.id);
      counters.deletes += 1;
      send(response, 200, { ok: true });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/retrieval/query/collection"
    ) {
      if (await applyFault("retrieval", request, response)) return;
      const body = JSON.parse((await readBody(request, 1024 * 1024)).toString("utf8"));
      const knowledgeId = String(body.collection_names?.[0] ?? "");
      if (!authorize(request, response, knowledgeId)) return;
      const candidates = [...files.values()]
        .filter((file) => file.knowledgeId === knowledgeId && file.docmost)
        .slice(0, Math.max(1, Math.min(100, Number(body.k ?? 40))));
      counters.retrievals += 1;
      send(response, 200, {
        documents: [candidates.map((file) => `Fixture content for ${file.fileName}`)],
        metadatas: [
          candidates.map((file, index) =>
            index % 2 === 0
              ? { docmost: file.docmost }
              : { file_id: file.id },
          ),
        ],
        distances: [candidates.map((_file, index) => index / 10)],
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/__retrieval/http-json") {
      if (await applyFault("http-json", request, response)) return;
      const body = JSON.parse((await readBody(request, 1024 * 1024)).toString("utf8"));
      const allowed = new Set(Array.isArray(body.allowedPageIds) ? body.allowedPageIds : []);
      const items = [...files.values()]
        .filter((file) => file.docmost && allowed.has(file.docmost.pageId))
        .map((file, index) => ({
          sourceType: file.docmost.sourceType,
          sourceId: file.docmost.sourceId,
          pageId: file.docmost.pageId,
          text: `Fixture content for ${file.fileName}`,
          score: 1 - index / 100,
        }));
      send(response, 200, { items });
      return;
    }

    send(response, 404, { detail: "mock endpoint not found" });
  } catch (error) {
    send(response, 400, {
      detail: error instanceof Error ? error.message : "invalid request",
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Mock Open WebUI listening on ${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
