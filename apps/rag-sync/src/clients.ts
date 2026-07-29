import type {
  RagAttachmentDeletedItem,
  RagAttachmentItem,
  RagChangeFeed,
  RagDatabaseDetail,
  RagDeletedItem,
  RagPageDetail,
  RagUpdateItem,
} from '@docmost/api-contract';
import { BoundedHttpClient, RemoteHttpError, delay } from './http-client.js';
import type {
  DocmostSourceClient,
  OpenWebUiFile,
  OpenWebUiWriterClient,
  RagSyncBinding,
} from './types.js';

export class DocmostClient implements DocmostSourceClient {
  private readonly http: BoundedHttpClient;

  constructor(
    binding: RagSyncBinding,
    requestTimeoutMs: number,
  ) {
    this.http = new BoundedHttpClient(
      binding.docmostBaseUrl,
      binding.docmostApiKey,
      requestTimeoutMs,
    );
  }

  getUpdates(updatedSince: number, cursor?: string) {
    return this.feed<RagUpdateItem>('api/rag/updates', 'updatedSince', updatedSince, cursor);
  }

  getDeleted(deletedSince: number, cursor?: string) {
    return this.feed<RagDeletedItem>('api/rag/deleted', 'deletedSince', deletedSince, cursor);
  }

  getAttachmentUpdates(updatedSince: number, cursor?: string) {
    return this.feed<RagAttachmentItem>(
      'api/rag/attachments/updates',
      'updatedSince',
      updatedSince,
      cursor,
    );
  }

  getAttachmentDeleted(deletedSince: number, cursor?: string) {
    return this.feed<RagAttachmentDeletedItem>(
      'api/rag/attachments/deleted',
      'deletedSince',
      deletedSince,
      cursor,
    );
  }

  getPage(pageId: string): Promise<RagPageDetail> {
    return this.http.json(
      `api/rag/pages/${encodeURIComponent(pageId)}?includeContent=true`,
    );
  }

  getDatabase(databaseId: string): Promise<RagDatabaseDetail> {
    return this.http.json(
      `api/rag/databases/${encodeURIComponent(databaseId)}`,
      {},
      8 * 1024 * 1024,
    );
  }

  downloadAttachment(
    item: RagAttachmentItem,
    maxBytes: number,
  ): Promise<Uint8Array> {
    const path = item.downloadUrl.replace(/^\/+/, '');
    if (!path.startsWith('api/rag/attachments/')) {
      throw new Error('Docmost returned an invalid attachment URL');
    }
    return this.http.bytes(path, {}, maxBytes);
  }

  private feed<T>(
    path: string,
    parameter: string,
    since: number,
    cursor?: string,
  ): Promise<RagChangeFeed<T>> {
    const query = new URLSearchParams({
      [parameter]: String(since),
      limit: '500',
    });
    if (cursor) query.set('cursor', cursor);
    return this.http.json(`${path}?${query.toString()}`, {}, 8 * 1024 * 1024);
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
  ): Promise<OpenWebUiFile> {
    const form = new FormData();
    const fileBytes = new Uint8Array(content.byteLength);
    fileBytes.set(content);
    form.set('file', new Blob([fileBytes], { type: mimeType }), fileName);
    form.set('metadata', JSON.stringify(metadata));
    return this.http.json<OpenWebUiFile>(
      'api/v1/files/?process=true&process_in_background=true',
      { method: 'POST', body: form },
      1024 * 1024,
    );
  }

  async waitUntilProcessed(fileId: string): Promise<void> {
    const deadline = Date.now() + this.processingTimeoutMs;
    while (Date.now() < deadline) {
      const result = await this.http.json<{ status?: string }>(
        `api/v1/files/${encodeURIComponent(fileId)}/process/status`,
        {},
        16 * 1024,
      );
      if (result.status === 'completed') return;
      if (result.status === 'failed' || result.status === 'not_found') {
        throw new Error('Open WebUI failed to process an uploaded file');
      }
      await delay(1000);
    }
    throw new Error('Open WebUI file processing timed out');
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.http.discard(
        `api/v1/files/${encodeURIComponent(fileId)}`,
        { method: 'DELETE' },
        [404],
      );
    } catch (error) {
      if (error instanceof RemoteHttpError && error.status === 404) return;
      throw error;
    }
  }

  async listKnowledgeFiles(): Promise<OpenWebUiFile[]> {
    const result: OpenWebUiFile[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.http.json<{
        items?: OpenWebUiFile[];
        total?: number;
      }>(
        `api/v1/knowledge/${encodeURIComponent(
          this.binding.knowledgeId,
        )}/files?page=${page}&limit=500&include_content=false`,
        {},
        8 * 1024 * 1024,
      );
      const items = Array.isArray(response.items) ? response.items : [];
      result.push(...items);
      if (
        items.length === 0 ||
        (Number.isFinite(response.total) && result.length >= Number(response.total))
      ) {
        break;
      }
    }
    return result;
  }
}
