import type {
  RagAttachmentDeletedItem,
  RagAttachmentItem,
  RagBlockedPageItem,
  RagChangeFeed,
  RagDatabaseDetail,
  RagDeletedItem,
  RagPageDetail,
  RagScope,
  RagUpdateItem,
} from "@docmost/api-contract";
import { BoundedHttpClient, RemoteHttpError, delay } from "./http-client.js";
import {
  OpenWebUiFileProcessingError,
  type DocmostSourceClient,
  type OpenWebUiFile,
  type OpenWebUiWriterClient,
  type RagSyncBinding,
} from "./types.js";

export class DocmostClient implements DocmostSourceClient {
  private readonly http: BoundedHttpClient;

  constructor(binding: RagSyncBinding, requestTimeoutMs: number) {
    this.http = new BoundedHttpClient(
      binding.docmostBaseUrl,
      binding.docmostApiKey,
      requestTimeoutMs,
    );
  }

  getScope(signal?: AbortSignal): Promise<RagScope> {
    return this.http.json("api/rag/scope", { signal }, 8 * 1024 * 1024);
  }

  getBlockedPages(
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<RagChangeFeed<RagBlockedPageItem>> {
    const query = new URLSearchParams({ limit: "500" });
    if (cursor) query.set("cursor", cursor);
    return this.http.json(
      `api/rag/scope/blocked?${query.toString()}`,
      { signal },
      8 * 1024 * 1024,
    );
  }

  getUpdates(updatedSince: number, cursor?: string, signal?: AbortSignal) {
    return this.feed<RagUpdateItem>(
      "api/rag/updates",
      "updatedSince",
      updatedSince,
      cursor,
      signal,
    );
  }

  getDeleted(deletedSince: number, cursor?: string, signal?: AbortSignal) {
    return this.feed<RagDeletedItem>(
      "api/rag/deleted",
      "deletedSince",
      deletedSince,
      cursor,
      signal,
    );
  }

  getAttachmentUpdates(
    updatedSince: number,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    return this.feed<RagAttachmentItem>(
      "api/rag/attachments/updates",
      "updatedSince",
      updatedSince,
      cursor,
      signal,
    );
  }

  getAttachmentDeleted(
    deletedSince: number,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    return this.feed<RagAttachmentDeletedItem>(
      "api/rag/attachments/deleted",
      "deletedSince",
      deletedSince,
      cursor,
      signal,
    );
  }

  getPage(pageId: string, signal?: AbortSignal): Promise<RagPageDetail> {
    return this.http.json(
      `api/rag/pages/${encodeURIComponent(pageId)}?includeContent=true`,
      { signal },
    );
  }

  getDatabase(
    databaseId: string,
    signal?: AbortSignal,
  ): Promise<RagDatabaseDetail> {
    return this.http.json(
      `api/rag/databases/${encodeURIComponent(databaseId)}`,
      { signal },
      8 * 1024 * 1024,
    );
  }

  downloadAttachment(
    item: RagAttachmentItem,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const path = item.downloadUrl.replace(/^\/+/, "");
    if (!path.startsWith("api/rag/attachments/")) {
      throw new Error("Docmost returned an invalid attachment URL");
    }
    return this.http.bytes(path, { signal }, maxBytes);
  }

  private feed<T>(
    path: string,
    parameter: string,
    since: number,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<RagChangeFeed<T>> {
    const query = new URLSearchParams({
      [parameter]: String(since),
      limit: "500",
    });
    if (cursor) query.set("cursor", cursor);
    return this.http.json(
      `${path}?${query.toString()}`,
      { signal },
      8 * 1024 * 1024,
    );
  }
}

export class OpenWebUiClient implements OpenWebUiWriterClient {
  private readonly http: BoundedHttpClient;

  constructor(
    private readonly binding: RagSyncBinding,
    requestTimeoutMs: number,
    private readonly processingTimeoutMs: number,
  ) {
    this.http = new BoundedHttpClient(
      binding.openWebUiBaseUrl,
      binding.openWebUiApiKey,
      requestTimeoutMs,
    );
  }

  async upload(
    fileName: string,
    mimeType: string,
    content: Uint8Array,
    metadata: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<OpenWebUiFile> {
    const form = new FormData();
    const fileBytes = new Uint8Array(content.byteLength);
    fileBytes.set(content);
    form.set("file", new Blob([fileBytes], { type: mimeType }), fileName);
    form.set("metadata", JSON.stringify(metadata));
    return this.http.json<OpenWebUiFile>(
      "api/v1/files/?process=true&process_in_background=true",
      { method: "POST", body: form, signal },
      1024 * 1024,
    );
  }

  async waitUntilProcessed(
    fileId: string,
    assertActive?: () => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + this.processingTimeoutMs;
    while (Date.now() < deadline) {
      assertActive?.();
      const result = await this.http.json<{ status?: string }>(
        `api/v1/files/${encodeURIComponent(fileId)}/process/status`,
        { signal },
        16 * 1024,
      );
      if (result.status === "completed") return;
      if (result.status === "failed" || result.status === "not_found") {
        throw new OpenWebUiFileProcessingError(fileId, result.status);
      }
      await delay(1000, signal);
      assertActive?.();
    }
    throw new OpenWebUiFileProcessingError(fileId, "timeout");
  }

  async deleteFile(fileId: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.http.discard(
        `api/v1/files/${encodeURIComponent(fileId)}`,
        { method: "DELETE", signal },
        [404],
      );
    } catch (error) {
      if (error instanceof RemoteHttpError && error.status === 404) return;
      throw error;
    }
  }

  async listKnowledgeFiles(signal?: AbortSignal): Promise<OpenWebUiFile[]> {
    const result: OpenWebUiFile[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.http.json<{
        items?: OpenWebUiFile[];
        total?: number;
      }>(
        `api/v1/knowledge/${encodeURIComponent(
          this.binding.knowledgeId,
        )}/files?page=${page}&limit=500&include_content=false`,
        { signal },
        8 * 1024 * 1024,
      );
      const items = Array.isArray(response.items) ? response.items : [];
      result.push(...items);
      if (
        items.length === 0 ||
        (Number.isFinite(response.total) &&
          result.length >= Number(response.total))
      ) {
        break;
      }
    }
    return result;
  }
}
