import { createServer } from "node:http";

const host = process.env.AI_PROFILE_MOCK_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.AI_PROFILE_MOCK_PORT || "18080", 10);
const requests = [];
const markerPattern = /PROFILE_MARKER:[\p{L}\p{N}_.-]+/u;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function proofFor(body) {
  const systemText = Array.isArray(body.messages)
    ? body.messages
        .filter((message) => message?.role === "system")
        .map((message) => String(message.content ?? ""))
        .join("\n")
    : "";
  const marker = systemText.match(markerPattern)?.[0] ?? "PROFILE_MARKER:NONE";
  return {
    model: String(body.model ?? ""),
    marker,
    text: `MODEL=${String(body.model ?? "")};${marker}`,
  };
}

function record(body, proof) {
  requests.push({
    model: proof.model,
    marker: proof.marker,
    stream: body.stream === true,
    hasSystemMessage: Array.isArray(body.messages)
      ? body.messages.some((message) => message?.role === "system")
      : false,
  });
  if (requests.length > 200) requests.shift();
}

function streamCompletion(response, proof) {
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
  });
  response.write(
    `data: ${JSON.stringify({
      choices: [{ delta: { content: proof.text }, finish_reason: null }],
    })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

function forcedToolCompletion(body, proof) {
  const toolName = body.tool_choice?.function?.name;
  if (!toolName) return null;
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          role: "assistant",
          tool_calls: [
            {
              id: "call_profile_capability_probe",
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify({ value: "ok" }),
              },
            },
          ],
        },
      },
    ],
    model: proof.model,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/healthz") {
    return json(response, 200, { ok: true });
  }
  if (request.method === "GET" && url.pathname === "/__requests") {
    return json(response, 200, { requests });
  }
  if (request.method === "POST" && url.pathname === "/__reset") {
    requests.length = 0;
    return json(response, 200, { ok: true });
  }
  if (request.method === "GET" && url.pathname === "/v1/models") {
    return json(response, 200, {
      data: ["qa-space-default", "qa-model-alpha", "qa-model-beta"].map(
        (id) => ({ id, object: "model" }),
      ),
      object: "list",
    });
  }
  if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    return json(response, 404, { error: { message: "not_found" } });
  }

  try {
    const body = await readJson(request);
    const proof = proofFor(body);
    record(body, proof);
    if (body.stream === true) return streamCompletion(response, proof);
    const toolCompletion = forcedToolCompletion(body, proof);
    if (toolCompletion) return json(response, 200, toolCompletion);
    return json(response, 200, {
      choices: [
        {
          finish_reason: "stop",
          message: { content: proof.text, role: "assistant" },
        },
      ],
      model: proof.model,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  } catch (error) {
    return json(response, 400, {
      error: {
        message:
          error instanceof Error && error.message === "request_too_large"
            ? "request_too_large"
            : "invalid_json",
      },
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`ai-profile-openai-mock listening on ${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
