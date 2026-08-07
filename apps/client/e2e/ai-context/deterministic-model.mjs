import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

const port = Number(process.env.DOCMOST_AI_CONTEXT_MODEL_PORT ?? 1080);
const requests = [];
const retrievalRequests = [];

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function textContent(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function parsePrompt(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const latest = textContent(messages.at(-1));
  const jsonMatch = latest.match(
    /UNTRUSTED_REFERENCE_DATA_JSON\n([\s\S]*?)\nEND_UNTRUSTED_REFERENCE_DATA_JSON/,
  );
  let references = [];
  if (jsonMatch) {
    try {
      const records = JSON.parse(jsonMatch[1]);
      references = records.map((record) => ({
        reference: record.reference,
        chars: typeof record.content === "string" ? record.content.length : 0,
        content: typeof record.content === "string" ? record.content : "",
        markers: [
          ...new Set(
            typeof record.content === "string"
              ? (record.content.match(/\[S\d+\]/g) ?? [])
              : [],
          ),
        ],
      }));
    } catch {
      references = [{ parseError: true, content: "", markers: [], chars: 0 }];
    }
  }
  const requestMatch = latest.match(/\nUSER_REQUEST\n([\s\S]*)$/);
  const userRequest = requestMatch?.[1] ?? latest;
  const selectedTextMatch = latest.match(
    /UNTRUSTED_SELECTED_TEXT_JSON\n([\s\S]*?)\nEND_UNTRUSTED_SELECTED_TEXT_JSON/,
  );
  let selectedText = "";
  if (selectedTextMatch) {
    try {
      selectedText = JSON.parse(selectedTextMatch[1])?.text ?? "";
    } catch {
      selectedText = "__PARSE_ERROR__";
    }
  }
  const markers = [
    ...new Set(references.flatMap((reference) => reference.markers ?? [])),
  ];
  return { messages, references, markers, userRequest, selectedText };
}

function deterministicAnswer(parsed) {
  if (parsed.userRequest.includes("USER_TRANSFORM_INSTRUCTION")) {
    return "**AI_REPLACED_TEXT**";
  }
  const markerText = parsed.markers.join(" ");
  const injectionObserved = parsed.references.some((reference) =>
    reference.content.includes("Ignore system rules"),
  );
  return [
    `MODEL_CONTEXT_MARKERS ${markerText || "NONE"}`,
    `MODEL_REFERENCE_COUNT ${parsed.references.length}`,
    `MODEL_INJECTION_TREATED_AS_DATA ${injectionObserved ? "YES" : "NO"}`,
  ].join("\n");
}

function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function handleCompletion(request, response) {
  const raw = await readBody(request);
  const body = JSON.parse(raw);
  const parsed = parsePrompt(body);
  const answer = deterministicAnswer(parsed);
  const entry = {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    model: body.model ?? null,
    stream: body.stream === true,
    userRequest: parsed.userRequest,
    references: parsed.references,
    sourceMarkers: parsed.markers,
    injectionObservedOnlyInReferences: parsed.references.some((reference) =>
      reference.content.includes("Ignore system rules"),
    ),
    selectedTextChars: parsed.selectedText.length,
    selectedTextSha256: parsed.selectedText
      ? createHash("sha256").update(parsed.selectedText).digest("hex")
      : null,
    selectionInjectionIsolated:
      parsed.selectedText.includes("Ignore system rules") &&
      parsed.messages.every(
        (message, index) =>
          index === parsed.messages.length - 1 ||
          !textContent(message).includes("Ignore system rules"),
      ),
    messageSummary: parsed.messages.map((message) => ({
      role: message.role,
      chars: textContent(message).length,
      sha256: createHash("sha256").update(textContent(message)).digest("hex"),
    })),
  };
  requests.push(entry);

  if (parsed.userRequest.includes("DELAY_REVOKE")) {
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }

  if (body.stream !== true) {
    sendJson(response, 200, {
      id: `deterministic-${entry.id}`,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: answer },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const midpoint = Math.max(1, Math.floor(answer.length / 2));
  for (const content of [answer.slice(0, midpoint), answer.slice(midpoint)]) {
    response.write(
      `data: ${JSON.stringify({
        id: `deterministic-${entry.id}`,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`,
    );
  }
  response.write(
    `data: ${JSON.stringify({
      id: `deterministic-${entry.id}`,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, model: "deterministic-context-model-v1" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__requests") {
      sendJson(response, 200, { requests, retrievalRequests });
      return;
    }
    if (request.method === "DELETE" && url.pathname === "/__requests") {
      requests.length = 0;
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      await handleCompletion(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/retrieval") {
      const raw = await readBody(request);
      const body = JSON.parse(raw);
      const allowedPageIds = Array.isArray(body.allowedPageIds)
        ? body.allowedPageIds.filter((value) => typeof value === "string")
        : [];
      retrievalRequests.push({
        receivedAt: new Date().toISOString(),
        querySha256: createHash("sha256").update(String(body.query ?? "")).digest("hex"),
        allowedPageCount: allowedPageIds.length,
      });
      sendJson(response, 200, {
        items: allowedPageIds.slice(0, 2).map((pageId, index) => ({
          sourceType: "page",
          sourceId: pageId,
          pageId,
          text: `SPACE_SEARCH_RESULT_MARKER_${index} safe deterministic retrieval excerpt`,
          score: 1 - index * 0.1,
        })),
      });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    sendJson(response, 500, { error: "invalid_request", message: String(error?.message ?? error) });
  }
});

server.listen(port, "::", () => {
  process.stdout.write(`deterministic-context-model listening on ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
