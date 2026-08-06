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
};
const operationUploads = new Map();

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
  return {
    metadata: JSON.parse(metadataMatch[1]),
    fileName: fileNameMatch?.[1] ?? "unknown",
  };
}

function publicFile(file) {
  return {
    id: file.id,
    filename: file.fileName,
    meta: { data: { docmost: file.docmost } },
  };
}

function statePayload() {
  return {
    counters,
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
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__state") {
      send(response, 200, statePayload());
      return;
    }

    const knowledgeMatch = url.pathname.match(
      /^\/api\/v1\/knowledge\/([A-Za-z0-9_-]+)\/files$/,
    );
    if (request.method === "GET" && knowledgeMatch) {
      const knowledgeId = knowledgeMatch[1];
      if (!authorize(request, response, knowledgeId)) return;
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const limit = Math.max(
        1,
        Math.min(500, Number(url.searchParams.get("limit") ?? 100)),
      );
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
      const body = await readBody(request);
      const { metadata, fileName } = parseUpload(body);
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
        docmost: metadata.docmost,
        createdAt: Date.now(),
      });
      const operationId = String(metadata.docmost.operationId ?? "");
      if (operationId) {
        operationUploads.set(
          operationId,
          (operationUploads.get(operationId) ?? 0) + 1,
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
      files.delete(file.id);
      counters.deletes += 1;
      send(response, 200, { ok: true });
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
