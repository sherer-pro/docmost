import { randomUUID } from "node:crypto";
import {
  request as apiRequest,
  type APIRequestContext,
} from "@playwright/test";
import JSZip from "jszip";
import { expect, loadState, test } from "../support";

type Conversation = { id: string; contextRevision: number };
type ChatFile = { id: string; name: string; status: string };

function unwrap<T>(payload: { data?: T; success?: boolean } | T): T {
  if (
    payload &&
    typeof payload === "object" &&
    "success" in payload &&
    "data" in payload
  ) {
    return payload.data as T;
  }
  return payload as T;
}

async function ownerApi() {
  const origin = process.env.DOCMOST_BASE_URL ?? "http://localhost:3000";
  const csrfToken = process.env.DOCMOST_CSRF_TOKEN!;
  return apiRequest.newContext({
    baseURL: origin,
    timeout: 60_000,
    extraHTTPHeaders: {
      Authorization: `Bearer ${process.env.DOCMOST_AUTH_TOKEN}`,
      Cookie: `csrfToken=${csrfToken}`,
      Origin: origin,
      Referer: `${origin}/`,
      "x-csrf-token": csrfToken,
      Accept: "application/json",
    },
  });
}

async function createConversation(api: APIRequestContext, pageId: string) {
  const response = await api.post("/api/ai/conversations", {
    data: {
      pageId,
      clientRequestId: randomUUID(),
      title: `File audit ${randomUUID()}`,
    },
  });
  expect(response.status()).toBe(201);
  return unwrap<Conversation>(await response.json());
}

async function listFiles(api: APIRequestContext, conversationId: string) {
  const response = await api.get(
    `/api/ai/conversations/${conversationId}/files`,
  );
  expect(response.ok()).toBe(true);
  return unwrap<{ items: ChatFile[] }>(await response.json()).items;
}

async function waitForFiles(
  api: APIRequestContext,
  conversationId: string,
  ids: string[],
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const items = await listFiles(api, conversationId);
    const selected = items.filter((item) => ids.includes(item.id));
    if (
      selected.length === ids.length &&
      selected.every((item) => ["ready", "failed"].includes(item.status))
    ) {
      return selected;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("AI chat files did not reach a terminal extraction state");
}

function simplePdf(text: string) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

async function simpleDocx(text: string) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("file upload accepts bounded supported files and keeps multipart idempotent", async () => {
  const state = await loadState();
  const api = await ownerApi();
  try {
    const conversation = await createConversation(api, state.pageId);
    const docx = await simpleDocx("DOCX audit text");
    const multipart = {
      pdf: {
        name: "audit.pdf",
        mimeType: "application/pdf",
        buffer: simplePdf("PDF audit text"),
      },
      docx: {
        name: "audit.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: docx,
      },
      image: { name: "audit.png", mimeType: "image/png", buffer: png },
      text: {
        name: "audit.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("plain audit text"),
      },
    };
    const idempotencyKey = `upload-${randomUUID()}`;
    const first = await api.post(
      `/api/ai/conversations/${conversation.id}/files`,
      { headers: { "Idempotency-Key": idempotencyKey }, multipart },
    );
    expect(first.status()).toBe(201);
    const replay = await api.post(
      `/api/ai/conversations/${conversation.id}/files`,
      { headers: { "Idempotency-Key": idempotencyKey }, multipart },
    );
    expect(replay.status()).toBe(201);
    const firstBatch = unwrap<{ id: string; files: ChatFile[] }>(
      await first.json(),
    );
    const replayBatch = unwrap<{ id: string; files: ChatFile[] }>(
      await replay.json(),
    );
    expect(replayBatch.id).toBe(firstBatch.id);
    expect(replayBatch.files.map((file) => file.id)).toEqual(
      firstBatch.files.map((file) => file.id),
    );
    const terminals = await waitForFiles(
      api,
      conversation.id,
      firstBatch.files.map((file) => file.id),
    );
    expect(terminals.map((file) => file.status)).toEqual(
      Array(4).fill("ready"),
    );

    const mismatch = await api.post(
      `/api/ai/conversations/${conversation.id}/files`,
      {
        headers: { "Idempotency-Key": idempotencyKey },
        multipart: {
          changed: {
            name: "changed.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("different"),
          },
        },
      },
    );
    expect(mismatch.status()).toBe(409);
    expect(JSON.stringify(await mismatch.json())).toContain(
      "idempotency_key_reused",
    );

    const concurrentKey = `concurrent-${randomUUID()}`;
    const concurrentMultipart = {
      file: {
        name: "concurrent.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("same multipart request"),
      },
    };
    const [left, right] = await Promise.all([
      api.post(`/api/ai/conversations/${conversation.id}/files`, {
        headers: { "Idempotency-Key": concurrentKey },
        multipart: concurrentMultipart,
      }),
      api.post(`/api/ai/conversations/${conversation.id}/files`, {
        headers: { "Idempotency-Key": concurrentKey },
        multipart: concurrentMultipart,
      }),
    ]);
    expect([left.status(), right.status()]).toEqual([201, 201]);
    const leftBatch = unwrap<{ id: string; files: ChatFile[] }>(
      await left.json(),
    );
    const rightBatch = unwrap<{ id: string; files: ChatFile[] }>(
      await right.json(),
    );
    expect(rightBatch.id).toBe(leftBatch.id);
    expect(rightBatch.files[0].id).toBe(leftBatch.files[0].id);
  } finally {
    await api.dispose();
  }
});

test("file upload rejects unsupported, spoofed, empty and oversized payloads", async () => {
  const state = await loadState();
  const api = await ownerApi();
  try {
    const conversation = await createConversation(api, state.pageId);
    const cases = [
      {
        name: "unsupported",
        payload: {
          name: "audit.exe",
          mimeType: "application/x-msdownload",
          buffer: Buffer.from("MZ"),
        },
      },
      {
        name: "spoofed",
        payload: {
          name: "audit.png",
          mimeType: "image/png",
          buffer: Buffer.from("<html>not an image</html>"),
        },
      },
      {
        name: "empty",
        payload: {
          name: "audit.txt",
          mimeType: "text/plain",
          buffer: Buffer.alloc(0),
        },
      },
      {
        name: "oversized",
        payload: {
          name: "audit.txt",
          mimeType: "text/plain",
          buffer: Buffer.alloc(25 * 1024 * 1024 + 1, 0x61),
        },
      },
    ];
    for (const item of cases) {
      const response = await api.post(
        `/api/ai/conversations/${conversation.id}/files`,
        {
          headers: { "Idempotency-Key": `${item.name}-${randomUUID()}` },
          multipart: { file: item.payload },
          timeout: 120_000,
        },
      );
      expect([400, 413]).toContain(response.status());
    }

    const noKey = await api.post(
      `/api/ai/conversations/${conversation.id}/files`,
      {
        multipart: {
          file: {
            name: "no-key.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("missing key"),
          },
        },
      },
    );
    expect(noKey.status()).toBe(400);

    const corrupt = await api.post(
      `/api/ai/conversations/${conversation.id}/files`,
      {
        headers: { "Idempotency-Key": `corrupt-${randomUUID()}` },
        multipart: {
          file: {
            name: "corrupt.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("%PDF-corrupt"),
          },
        },
      },
    );
    expect(corrupt.status()).toBe(201);
    const corruptBatch = unwrap<{ files: ChatFile[] }>(await corrupt.json());
    const terminal = await waitForFiles(api, conversation.id, [
      corruptBatch.files[0].id,
    ]);
    expect(terminal[0].status).toBe("failed");
  } finally {
    await api.dispose();
  }
});

test("backend rejects selected visual input when vision is disabled", async () => {
  const state = await loadState();
  const api = await ownerApi();
  try {
    const conversation = await createConversation(api, state.pageId);
    const upload = await api.post(
      `/api/ai/conversations/${conversation.id}/files`,
      {
        headers: { "Idempotency-Key": `vision-${randomUUID()}` },
        multipart: {
          file: { name: "vision.png", mimeType: "image/png", buffer: png },
        },
      },
    );
    expect(upload.status()).toBe(201);
    const batch = unwrap<{ files: ChatFile[] }>(await upload.json());
    const [image] = await waitForFiles(api, conversation.id, [
      batch.files[0].id,
    ]);
    expect(image.status).toBe("ready");

    const contextUpdate = await api.put(
      `/api/ai/conversations/${conversation.id}/context`,
      {
        data: {
          expectedRevision: conversation.contextRevision ?? 0,
          includeCurrentDocument: false,
          sources: [],
          fileIds: [image.id],
          attachmentIds: [],
        },
      },
    );
    expect(contextUpdate.ok()).toBe(true);
    const context = unwrap<{ revision: number }>(await contextUpdate.json());
    const disabled = await api.patch(`/api/spaces/${state.spaceId}/ai/config`, {
      data: { visionEnabled: false },
    });
    expect(disabled.ok()).toBe(true);

    const send = await api.post(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        data: {
          content: "Describe the selected image",
          clientRequestId: randomUUID(),
          contextRevision: context.revision,
        },
      },
    );
    expect(send.status()).toBe(400);
    expect(JSON.stringify(await send.json())).toContain("ai_vision_required");
  } finally {
    await api.patch(`/api/spaces/${state.spaceId}/ai/config`, {
      data: { visionEnabled: true },
    });
    await api.dispose();
  }
});
