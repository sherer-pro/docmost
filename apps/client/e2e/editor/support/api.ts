import {
  request,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { auditStatePath } from "./paths";
import { apiBaseUrl, apiOrigin, requiredSecret } from "./auth";
import type { AttachmentRecord, AuditState, PageRecord } from "./types";

type JsonObject = Record<string, unknown>;

export async function parseResponse<T>(response: APIResponse): Promise<T> {
  const body = await response.text();
  if (!response.ok()) {
    throw new Error(
      `${new URL(response.url()).pathname} failed with ${response.status()}: ${body.slice(0, 600)}`,
    );
  }
  if (!body) return undefined as T;
  const parsed = JSON.parse(body) as JsonObject;
  if (
    parsed &&
    typeof parsed === "object" &&
    "success" in parsed &&
    "data" in parsed
  ) {
    return parsed.data as T;
  }
  return parsed as T;
}

export async function createAdminApi(): Promise<APIRequestContext> {
  const origin = apiOrigin();
  const csrfToken = requiredSecret("DOCMOST_CSRF_TOKEN");
  const authToken = requiredSecret("DOCMOST_AUTH_TOKEN");
  return request.newContext({
    baseURL: apiBaseUrl(),
    extraHTTPHeaders: {
      Authorization: `Bearer ${authToken}`,
      Cookie: `csrfToken=${csrfToken}`,
      Host: new URL(origin).host,
      Origin: origin,
      Referer: `${origin}/`,
      "x-csrf-token": csrfToken,
      Accept: "application/json",
    },
  });
}

export async function loadAuditState(): Promise<AuditState> {
  return JSON.parse(await fs.readFile(auditStatePath, "utf8")) as AuditState;
}

export async function apiPost<T>(
  api: APIRequestContext,
  url: string,
  data: JsonObject,
): Promise<T> {
  return parseResponse<T>(await api.post(url, { data }));
}

export async function apiPostWithHeaders<T>(
  api: APIRequestContext,
  url: string,
  data: JsonObject,
  headers: Record<string, string>,
): Promise<T> {
  return parseResponse<T>(await api.post(url, { data, headers }));
}

export async function apiDelete<T>(
  api: APIRequestContext,
  url: string,
): Promise<T> {
  return parseResponse<T>(await api.delete(url));
}

export async function apiGet<T>(
  api: APIRequestContext,
  url: string,
): Promise<T> {
  return parseResponse<T>(await api.get(url));
}

export async function createPage(
  api: APIRequestContext,
  spaceId: string,
  title: string,
  content: JsonObject = {
    type: "doc",
    content: [{ type: "paragraph" }],
  },
  parentPageId?: string,
): Promise<PageRecord> {
  const page = await apiPost<PageRecord>(api, "/api/pages", {
    spaceId,
    title,
    content,
    format: "json",
    ...(parentPageId ? { parentPageId } : {}),
  });
  await updatePageContent(api, page.id, content);
  return page;
}

export async function updatePageContent(
  api: APIRequestContext,
  pageId: string,
  content: JsonObject,
): Promise<PageRecord> {
  return apiPost<PageRecord>(api, "/api/pages/actions/update", {
    pageId,
    content,
    format: "json",
    operation: "replace",
  });
}

export async function deletePage(
  api: APIRequestContext,
  pageId: string,
): Promise<void> {
  await apiPost(api, "/api/pages/actions/delete", {
    pageId,
    permanentlyDelete: true,
  });
}

export async function uploadFixture(
  api: APIRequestContext,
  pageId: string,
  name: string,
  mimeType: string,
  buffer: Buffer,
): Promise<AttachmentRecord> {
  return parseResponse<AttachmentRecord>(
    await api.post(`/api/attachments/actions/upload-file?pageId=${pageId}`, {
      multipart: {
        pageId,
        file: { name, mimeType, buffer },
      },
    }),
  );
}

export function attachmentUrl(attachment: AttachmentRecord): string {
  return `/api/attachments/files/${attachment.id}/${encodeURIComponent(attachment.fileName)}`;
}

export function buildTinyPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 72 720 Td (Docmost editor audit PDF) Tj ET";
  objects[3] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

export function buildSilentWav(durationMs = 400): Buffer {
  const sampleRate = 8_000;
  const samples = Math.floor((sampleRate * durationMs) / 1_000);
  const buffer = Buffer.alloc(44 + samples, 128);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples, 40);
  return buffer;
}

export function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

export function tinySvg(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect width="120" height="60" fill="#228be6"/><text x="60" y="35" text-anchor="middle" fill="white">Audit</text></svg>',
    "utf8",
  );
}

export function pseudoMp4(): Buffer {
  return Buffer.from(
    "AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVl",
    "base64",
  );
}

export function uniqueId(_prefix: string): string {
  return randomUUID();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function hashProseMirrorJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
