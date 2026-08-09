import { createHash, randomUUID } from "node:crypto";
import http from "node:http";

const port = Number(process.env.DOCMOST_AI_AGENT_MODEL_PORT ?? 1180);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("DOCMOST_AI_AGENT_MODEL_PORT must be a valid TCP port");
}

const requests = [];
const scenarios = new Map();
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_LOG = 1000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return { raw, value: raw ? JSON.parse(raw) : {} };
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function scenarioFrom(messages) {
  const userText = messages
    .filter((message) => message?.role === "user")
    .map((message) => textContent(message.content))
    .join("\n");
  return userText.match(/AGENT_AUDIT:([a-z0-9_-]+)/i)?.[1]?.toLowerCase() ?? "default";
}

function currentPageId(messages) {
  const system = messages
    .filter((message) => message?.role === "system")
    .map((message) => textContent(message.content))
    .join("\n");
  return system.match(/current page ID is ([0-9a-f-]{36})/i)?.[1] ?? null;
}

function previousToolNames(messages) {
  return messages.flatMap((message) =>
    Array.isArray(message?.tool_calls)
      ? message.tool_calls
          .map((call) => call?.function?.name)
          .filter((name) => typeof name === "string")
      : [],
  );
}

function latestToolResult(messages) {
  const message = [...messages]
    .reverse()
    .find((candidate) => candidate?.role === "tool" && typeof candidate.content === "string");
  if (!message) return null;
  try {
    return JSON.parse(message.content);
  } catch {
    return null;
  }
}

function definitionNames(tools) {
  return Array.isArray(tools)
    ? tools
        .map((tool) => tool?.function?.name)
        .filter((name) => typeof name === "string")
    : [];
}

function toolCall(name, args, index = 0) {
  return {
    id: `audit-${name}-${index}-${randomUUID()}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function readOutline(result) {
  const value = result?.result ?? result;
  const items = Array.isArray(value?.items) ? value.items : [];
  const item =
    items.find(
      (candidate) =>
        typeof candidate?.id === "string" &&
        candidate.type === "paragraph" &&
        typeof candidate.text === "string" &&
        candidate.text.length > 0,
    ) ??
    items.find(
      (candidate) =>
        typeof candidate?.id === "string" &&
        typeof candidate.text === "string" &&
        candidate.text.length > 0,
    );
  return item
    ? {
        id: item.id,
        text: item.text,
        contentHash:
          typeof value?.contentHash === "string" ? value.contentHash : undefined,
      }
    : null;
}

function agentChoice(body, scenario) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const available = new Set(definitionNames(body.tools));
  const pageId = currentPageId(messages);
  const previous = previousToolNames(messages);

  if (available.has("capabilityProbe")) {
    return {
      content: "",
      toolCalls: [toolCall("capabilityProbe", { value: "ok" })],
      finishReason: "tool_calls",
    };
  }

  if (scenario === "step-limit") {
    return {
      content: "",
      toolCalls: [toolCall("getOutline", { pageId }, previous.length)],
      finishReason: "tool_calls",
    };
  }

  if (scenario === "tool-limit") {
    return {
      content: "",
      toolCalls: Array.from({ length: 16 }, (_, index) =>
        toolCall("getOutline", { pageId }, previous.length + index),
      ),
      finishReason: "tool_calls",
    };
  }

  if (scenario === "result-limit") {
    return {
      content: "",
      toolCalls: [toolCall("getPage", { pageId }, previous.length)],
      finishReason: "tool_calls",
    };
  }

  if (!previous.includes("getOutline")) {
    if (!pageId || !available.has("getOutline")) {
      return {
        content: "The deterministic agent catalog does not permit getOutline.",
        toolCalls: [],
        finishReason: "stop",
      };
    }
    return {
      content: "I will inspect the live outline before proposing a change.",
      toolCalls: [toolCall("getOutline", { pageId })],
      finishReason: "tool_calls",
    };
  }

  if (!previous.includes("editPageText")) {
    const outline = readOutline(latestToolResult(messages));
    if (!outline || !available.has("editPageText")) {
      return {
        content: "The deterministic agent could not create a safe text proposal.",
        toolCalls: [],
        finishReason: "stop",
      };
    }
    return {
      content: "I prepared one bounded text proposal for approval.",
      toolCalls: [
        toolCall("editPageText", {
          pageId,
          nodeId: outline.id,
          oldText: outline.text,
          newText: `${outline.text} [${scenario.startsWith("parallel-") ? `${scenario} ` : ""}agent audit approved]`,
          ...(outline.contentHash
            ? { outlineContentHash: outline.contentHash }
            : {}),
        }),
      ],
      finishReason: "tool_calls",
    };
  }

  return {
    content: "The deterministic agent observed the decided proposal and finished.",
    toolCalls: [],
    finishReason: "stop",
  };
}

function completion(choice) {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "docmost-agent-audit-v1",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: choice.content,
          ...(choice.toolCalls.length > 0 ? { tool_calls: choice.toolCalls } : {}),
        },
        finish_reason: choice.finishReason,
      },
    ],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  };
}

function streamCompletion(response, choice) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const delta = {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "docmost-agent-audit-v1",
    choices: [
      {
        index: 0,
        delta:
          choice.toolCalls.length > 0
            ? { role: "assistant", tool_calls: choice.toolCalls }
            : { role: "assistant", content: choice.content },
        finish_reason: null,
      },
    ],
  };
  response.write(`data: ${JSON.stringify(delta)}\n\n`);
  response.write(
    `data: ${JSON.stringify({
      ...delta,
      choices: [{ index: 0, delta: {}, finish_reason: choice.finishReason }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

async function handleCompletion(request, response) {
  const { raw, value: body } = await readJson(request);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const scenario = scenarioFrom(messages);
  const configured = scenarios.get(scenario) ?? {};
  const toolNames = definitionNames(body.tools);
  const userText = messages
    .filter((message) => message?.role === "user")
    .map((message) => textContent(message.content))
    .join("\n");
  requests.push({
    at: new Date().toISOString(),
    scenario,
    bodyHash: sha256(raw),
    userContentHash: sha256(userText),
    userContentBytes: Buffer.byteLength(userText),
    messageCount: messages.length,
    stream: body.stream === true,
    hasTools: toolNames.length > 0,
    toolNames,
    toolChoice: body.tool_choice ?? null,
  });
  if (requests.length > MAX_REQUEST_LOG) requests.splice(0, requests.length - MAX_REQUEST_LOG);

  const delayMs = Number(configured.delayMs ?? 0);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 120_000)));
  }
  if (configured.disconnect === true) {
    request.socket.destroy();
    return;
  }

  const choice = toolNames.length > 0
    ? agentChoice(body, scenario)
    : {
        content: "Deterministic chat response without agent tools.",
        toolCalls: [],
        finishReason: "stop",
      };
  if (body.stream === true) streamCompletion(response, choice);
  else sendJson(response, 200, completion(choice));
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, model: "docmost-agent-audit-v1" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, 200, {
        object: "list",
        data: [{ id: "docmost-agent-audit-v1", object: "model" }],
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__requests") {
      sendJson(response, 200, { requests });
      return;
    }
    if (request.method === "DELETE" && url.pathname === "/__requests") {
      requests.length = 0;
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__scenario") {
      sendJson(response, 200, { scenarios: Object.fromEntries(scenarios) });
      return;
    }
    if (["POST", "PUT"].includes(request.method ?? "") && url.pathname === "/__scenario") {
      const { value } = await readJson(request);
      if (typeof value?.name !== "string" || !/^[a-z0-9_-]+$/i.test(value.name)) {
        sendJson(response, 400, { error: "name is required" });
        return;
      }
      scenarios.set(value.name.toLowerCase(), {
        delayMs: Number(value.delayMs ?? 0),
        disconnect: value.disconnect === true,
      });
      sendJson(response, 200, { ok: true, name: value.name.toLowerCase() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      await handleCompletion(request, response);
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "invalid_request",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`deterministic agent model listening on ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
