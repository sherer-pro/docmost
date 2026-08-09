import { createHash, randomUUID } from "node:crypto";
import http from "node:http";

const port = Number(process.env.AI_MCP_MODEL_PORT ?? 3320);
const requests = [];
const MAX_BODY_BYTES = 5 * 1024 * 1024;

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
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
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

function userScenario(messages) {
  const text = messages
    .filter((message) => message?.role === "user")
    .map((message) => textContent(message.content))
    .join("\n");
  return text.match(/MCP_AUDIT:([A-Z_]+)/i)?.[1]?.toLowerCase() ?? "echo";
}

function toolNames(body) {
  return (Array.isArray(body.tools) ? body.tools : [])
    .map((tool) => tool?.function?.name)
    .filter((name) => typeof name === "string");
}

function argumentsFor(tool) {
  const schema = tool?.function?.parameters;
  const properties = schema?.properties && typeof schema.properties === "object"
    ? schema.properties
    : {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const names = required.length > 0 ? required : Object.keys(properties).slice(0, 1);
  return Object.fromEntries(
    names.map((name) => {
      const type = properties[name]?.type;
      if (type === "integer" || type === "number") return [name, 1];
      if (type === "boolean") return [name, true];
      if (type === "array") return [name, []];
      if (type === "object") return [name, {}];
      return [name, "MCP_SAFE_ECHO_CANARY"];
    }),
  );
}

function chooseTool(body, scenario) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const expectedSlug =
    scenario === "blocked" ? "blocked_echo" :
      scenario === "malicious" ? "malicious_result" : "echo";
  return tools.find((tool) => {
    const name = tool?.function?.name;
    return typeof name === "string" &&
      name.startsWith("mcp__") &&
      name.includes(`__${expectedSlug}_`);
  });
}

function decision(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const scenario = userScenario(messages);
  const probe = (Array.isArray(body.tools) ? body.tools : []).find(
    (tool) => tool?.function?.name === "capabilityProbe",
  );
  if (probe) {
    return {
      content: "",
      toolCalls: [
        {
          id: `mcp-audit-probe-${randomUUID()}`,
          type: "function",
          function: { name: "capabilityProbe", arguments: '{"value":"ok"}' },
        },
      ],
      finishReason: "tool_calls",
    };
  }
  const toolResult = [...messages]
    .reverse()
    .find((message) => message?.role === "tool" && typeof message.content === "string");
  if (toolResult) {
    return {
      content: scenario === "malicious"
        ? toolResult.content
        : "MCP_AUDIT_COMPLETED_WITH_UNTRUSTED_RESULT",
      toolCalls: [],
      finishReason: "stop",
    };
  }

  const tool = chooseTool(body, scenario);
  if (!tool) {
    return {
      content: "MCP_AUDIT_NO_APPROVED_EXTERNAL_TOOL",
      toolCalls: [],
      finishReason: "stop",
    };
  }
  return {
    content: "",
    toolCalls: [
      {
        id: `mcp-audit-${randomUUID()}`,
        type: "function",
        function: {
          name: tool.function.name,
          arguments: JSON.stringify(argumentsFor(tool)),
        },
      },
    ],
    finishReason: "tool_calls",
  };
}

function completion(choice) {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "docmost-mcp-audit-v1",
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
    usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 },
  };
}

function stream(response, choice) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const base = {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "docmost-mcp-audit-v1",
  };
  response.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [
        {
          index: 0,
          delta: choice.toolCalls.length > 0
            ? {
                role: "assistant",
                tool_calls: choice.toolCalls.map((toolCall, index) => ({
                  index,
                  ...toolCall,
                })),
              }
            : { role: "assistant", content: choice.content },
          finish_reason: null,
        },
      ],
    })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: choice.finishReason }],
      usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, model: "docmost-mcp-audit-v1" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, 200, {
        object: "list",
        data: [{ id: "docmost-mcp-audit-v1", object: "model" }],
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__audit/requests") {
      sendJson(response, 200, { requests });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const { raw, value: body } = await readJson(request);
      const names = toolNames(body);
      requests.push({
        bodyHash: sha256(raw),
        toolNames: names,
        externalToolCount: names.filter((name) => name.startsWith("mcp__")).length,
        writeLikeToolOffered: names.some((name) => name.includes("claimed_readonly_write")),
      });
      if (requests.length > 200) requests.shift();
      const choice = decision(body);
      if (body.stream === true) stream(response, choice);
      else sendJson(response, 200, completion(choice));
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
  process.stdout.write(`deterministic MCP audit model listening on ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
