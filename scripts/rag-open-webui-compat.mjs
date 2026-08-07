import { randomUUID } from "node:crypto";
import JSZip from "jszip";

const baseUrl = new URL(
  process.env.OPEN_WEBUI_COMPAT_URL ?? "http://127.0.0.1:18082",
);
const email = `docmost-rag-${Date.now()}@example.test`;
const password = "Open-WebUI-compat-password-123!";

async function json(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`${options.method ?? "GET"} ${path} returned malformed JSON`);
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}`);
  }
  return payload;
}

async function waitForHealth() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("health", baseUrl));
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Open WebUI did not become healthy");
}

await waitForHealth();
const auth = await json("api/v1/auths/signup", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Docmost RAG test", email, password }),
});
const token = auth.token;
if (!token) throw new Error("Open WebUI signup omitted a bearer token");
const headers = { authorization: `Bearer ${token}` };
const knowledge = await json("api/v1/knowledge/create", {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({
    name: `Docmost compatibility ${Date.now()}`,
    description: "Ephemeral Docmost compatibility collection",
    data: {},
  }),
});
if (!knowledge.id) throw new Error("Open WebUI knowledge create omitted id");

function createPdf(text) {
  const escaped = text.replace(/([()\\])/g, "\\$1");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

async function createDocx(text) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

const uploadedFileIds = [];
try {
  const fixtures = [
    {
      name: "docmost-compatibility.md",
      type: "text/markdown",
      bytes: Buffer.from("Docmost Markdown compatibility sentinel 8f516876"),
    },
    {
      name: "docmost-compatibility.pdf",
      type: "application/pdf",
      bytes: createPdf("Docmost PDF compatibility sentinel 4a7d20c1"),
    },
    {
      name: "docmost-compatibility.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await createDocx("Docmost DOCX compatibility sentinel b13f6850"),
    },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const sourceId = randomUUID();
    const contentHash = String(index + 1).repeat(64);
    const form = new FormData();
    form.set("file", new Blob([fixture.bytes], { type: fixture.type }), fixture.name);
    form.set(
      "metadata",
      JSON.stringify({
        knowledge_id: knowledge.id,
        file_hash: contentHash,
        docmost: {
          schemaVersion: 2,
          bindingId: randomUUID(),
          targetVersion: 1,
          workspaceId: randomUUID(),
          spaceId: randomUUID(),
          sourceType: "attachment",
          sourceId,
          pageId: randomUUID(),
          sourceUpdatedAtMs: Date.now(),
          contentHash,
          operationId: randomUUID(),
          ownershipMac: "c".repeat(64),
        },
      }),
    );
    const uploaded = await json(
      "api/v1/files/?process=true&process_in_background=true",
      { method: "POST", headers, body: form },
    );
    if (!uploaded.id) throw new Error(`Open WebUI upload omitted id for ${fixture.name}`);
    uploadedFileIds.push(uploaded.id);

    let completed = false;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const status = await json(`api/v1/files/${uploaded.id}/process/status`, {
        headers,
      });
      if (status.status === "completed") {
        completed = true;
        break;
      }
      if (["failed", "not_found"].includes(status.status)) {
        throw new Error(`Open WebUI processing failed for ${fixture.name}: ${status.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!completed) throw new Error(`Open WebUI processing timed out for ${fixture.name}`);
  }
  const page = await json(
    `api/v1/knowledge/${knowledge.id}/files?page=1&limit=30&include_content=false`,
    { headers },
  );
  for (const fileId of uploadedFileIds) {
    if (!page.items?.some((file) => file.id === fileId)) {
      throw new Error(`Uploaded file ${fileId} is absent from the Knowledge listing`);
    }
  }
  const retrieval = await json("api/v1/retrieval/query/collection", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      collection_names: [knowledge.id],
      query: "8f516876",
      k: 5,
      hybrid: false,
    }),
  });
  if (!Array.isArray(retrieval.documents?.[0])) {
    throw new Error("Open WebUI retrieval response shape is incompatible");
  }
  process.stdout.write("Open WebUI v0.11.0 writer and retrieval contracts are compatible\n");
} finally {
  for (const fileId of uploadedFileIds) {
    await fetch(new URL(`api/v1/files/${fileId}`, baseUrl), {
      method: "DELETE",
      headers,
    }).catch(() => undefined);
  }
  await fetch(new URL(`api/v1/knowledge/${knowledge.id}/delete`, baseUrl), {
    method: "DELETE",
    headers,
  }).catch(() => undefined);
}
