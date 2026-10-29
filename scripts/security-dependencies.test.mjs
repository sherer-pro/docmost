import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createSmtpServer } from "node:net";
import { createRequire } from "node:module";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import test from "node:test";
import StarterKit from "@tiptap/starter-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const serverRequire = createRequire(
  new URL("../apps/server/package.json", import.meta.url),
);
const { generateJSON } = serverRequire(
  "./src/common/helpers/prosemirror/html/generateJSON.ts",
);
const { generateHTML } = serverRequire(
  "./src/common/helpers/prosemirror/html/generateHTML.ts",
);
const { SmtpDriver } = serverRequire(
  "./src/integrations/mail/drivers/smtp.driver.ts",
);
const { createAiPinnedDispatcher } = serverRequire(
  "./src/core/ai/services/ai-pinned-http.util.ts",
);
const { Window } = await import(
  pathToFileURL(serverRequire.resolve("happy-dom")).href
);
const multipartRequire = createRequire(
  serverRequire.resolve("@fastify/multipart"),
);
const Busboy = multipartRequire("@fastify/busboy");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function closeHttp(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("real server HTML conversion round-trips through the upgraded DOM", () => {
  const extensions = [StarterKit];
  const document = generateJSON(
    "<h2>Fixture</h2><p>Safe <strong>content</strong>.</p>",
    extensions,
  );
  const html = generateHTML(document, extensions);
  assert.match(html, /<h2[^>]*>Fixture<\/h2>/u);
  assert.match(html, /<strong>content<\/strong>/u);
  assert.deepEqual(generateJSON(html, extensions), document);
});

test("real DOM defaults do not fetch untrusted iframe or stylesheet URLs", async () => {
  let requests = 0;
  const server = createHttpServer((_request, response) => {
    requests += 1;
    response.end("synthetic resource");
  });
  const port = await listen(server);
  const window = new Window({ url: `http://127.0.0.1:${port}` });
  try {
    window.document.write(
      `<link rel="stylesheet" href="http://127.0.0.1:${port}/style"><iframe src="http://127.0.0.1:${port}/frame"></iframe>`,
    );
    await window.happyDOM.whenAsyncComplete();
    assert.equal(requests, 0);
  } finally {
    await window.happyDOM.abort();
    await window.happyDOM.close();
    await closeHttp(server);
  }
});

async function smtpFixture(rejectRecipient = false) {
  const sockets = new Set();
  const received = { authenticated: false, envelope: [], messages: [] };
  const server = createSmtpServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.write("220 fixture.invalid ESMTP\r\n");
    let pending = "";
    let data;
    socket.on("data", (chunk) => {
      pending += chunk.toString();
      let end;
      while ((end = pending.indexOf("\r\n")) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data) {
          if (line === ".") {
            received.messages.push(data.join("\r\n"));
            data = undefined;
            socket.write("250 queued fixture\r\n");
          } else data.push(line);
        } else if (/^EHLO /u.test(line)) {
          socket.write(
            "250-fixture.invalid\r\n250-AUTH PLAIN\r\n250 SIZE 262144\r\n",
          );
        } else if (/^AUTH PLAIN /u.test(line)) {
          received.authenticated =
            Buffer.from(line.slice(11), "base64").toString() ===
            "\0fixture-user\0synthetic-only-password";
          socket.write(
            received.authenticated ? "235 authenticated\r\n" : "535 denied\r\n",
          );
        } else if (/^(?:MAIL FROM|RCPT TO):/u.test(line)) {
          received.envelope.push(line);
          socket.write(
            rejectRecipient && line.startsWith("RCPT")
              ? "550 rejected fixture\r\n"
              : "250 accepted\r\n",
          );
        } else if (line === "DATA") {
          data = [];
          socket.write("354 end with dot\r\n");
        } else if (line === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 accepted\r\n");
      }
    });
  });
  const port = await listen(server);
  return {
    received,
    driver: new SmtpDriver({
      host: "127.0.0.1",
      port,
      secure: false,
      ignoreTLS: true,
      auth: { user: "fixture-user", pass: "synthetic-only-password" },
      connectionTimeout: 2000,
      socketTimeout: 2000,
    }),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const message = {
  from: "sender@fixture.invalid",
  to: "recipient@fixture.invalid",
  subject: "Synthetic dependency test",
  text: "Plain fixture content",
  html: "<p>HTML fixture content</p>",
};

test("real SMTP driver authenticates and sends multipart mail to loopback only", async () => {
  const fixture = await smtpFixture();
  try {
    await fixture.driver.sendMail(message);
    assert.equal(fixture.received.authenticated, true);
    assert.equal(fixture.received.messages.length, 1);
    assert.match(
      fixture.received.envelope.join("\n"),
      /RCPT TO:<recipient@fixture.invalid>/u,
    );
    assert.match(fixture.received.messages[0], /multipart\/alternative/u);
    assert.match(fixture.received.messages[0], /Plain fixture content/u);
    assert.match(fixture.received.messages[0], /HTML fixture content/u);
  } finally {
    await fixture.close();
  }
});

test("real SMTP driver preserves recipient rejection as a failed delivery", async () => {
  const fixture = await smtpFixture(true);
  try {
    await assert.rejects(fixture.driver.sendMail(message), {
      responseCode: 550,
    });
    assert.equal(fixture.received.messages.length, 0);
  } finally {
    await fixture.close();
  }
});

test("upgraded HTTP agent connects only to its approved address", async () => {
  let host;
  const server = createHttpServer((request, response) => {
    host = request.headers.host;
    response.end("pinned fixture");
  });
  const port = await listen(server);
  const pinned = createAiPinnedDispatcher([
    { address: "127.0.0.1", family: 4 },
  ]);
  try {
    const response = await fetch(`http://approved.fixture.invalid:${port}/`, {
      dispatcher: pinned.dispatcher,
    });
    assert.equal(await response.text(), "pinned fixture");
    assert.equal(host, `approved.fixture.invalid:${port}`);
  } finally {
    await pinned.close();
    await closeHttp(server);
  }
});

test("real multipart parser retains bounded file data and limit events", async () => {
  const parser = new Busboy({
    headers: {
      "content-type": "multipart/form-data; boundary=fixture-boundary",
    },
    limits: { fileSize: 3 },
  });
  let limit = false;
  let content = "";
  parser.on("file", (_name, stream) => {
    stream.on("limit", () => {
      limit = true;
    });
    stream.on("data", (chunk) => {
      content += chunk.toString();
    });
  });
  const finished = once(parser, "finish");
  parser.end(
    '--fixture-boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture.txt"\r\nContent-Type: text/plain\r\n\r\nabcdef\r\n--fixture-boundary--\r\n',
  );
  await finished;
  assert.equal(content, "abc");
  assert.equal(limit, true);
});

test("real stateless MCP transport accepts a client and bounds parsed batches", async () => {
  const server = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : undefined;
    const mcp = new Server(
      { name: "fixture", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } finally {
      await mcp.close();
    }
  });
  const port = await listen(server);
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const client = new Client({ name: "fixture-client", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(url));
    assert.deepEqual((await client.listTools()).tools, []);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(
        Array.from({ length: 101 }, () => ({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        })),
      ),
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Batch must not exceed 100 messages/u);
  } finally {
    await client.close();
    await closeHttp(server);
  }
});
