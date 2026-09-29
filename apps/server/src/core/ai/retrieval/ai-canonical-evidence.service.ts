import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import type { User } from '@docmost/db/types/entity.types';
import {
  RagContentExportService,
  RagAuthContext,
} from '../../rag/rag-content-export.service';
import { StorageService } from '../../../integrations/storage/storage.service';
import type { AiRetrievalHit } from '../ai.types';
import type { KnowledgeHeading } from '../../rag/structured-knowledge.util';

@Injectable()
export class AiCanonicalEvidenceService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly rag: RagContentExportService,
    private readonly storage: StorageService,
  ) {}

  async load(
    hit: AiRetrievalHit,
    user: User,
    workspaceId: string,
    spaceId: string,
    signal?: AbortSignal,
  ): Promise<{
    markdown: string;
    version: string;
    headings?: KnowledgeHeading[];
  } | null> {
    signal?.throwIfAborted();
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    if (!space) return null;
    signal?.throwIfAborted();
    const scope = {
      user,
      workspace: { id: workspaceId },
      space,
    } as RagAuthContext;
    if (hit.sourceType === 'dictionary_term') {
      const term = await this.rag.getDictionaryTerm(scope, hit.sourceId);
      return {
        markdown: term.knowledgeMarkdown,
        version: new Date(term.updatedAt).toISOString(),
      };
    }
    if (!hit.pageId) return null;
    if (hit.sourceType === 'attachment') {
      const file = await this.rag.resolveAttachmentForDownload(
        scope,
        hit.sourceId,
      );
      if (
        file.pageId !== hit.pageId ||
        Number(file.fileSize) > 25 * 1024 * 1024
      )
        return null;
      const stream = await this.storage.readStream(file.filePath, signal);
      const chunks: Buffer[] = [];
      let bytes = 0;
      try {
        for await (const value of stream) {
          signal?.throwIfAborted();
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          bytes += chunk.length;
          if (bytes > 25 * 1024 * 1024) return null;
          chunks.push(chunk);
        }
      } finally {
        stream.destroy();
      }
      const content = Buffer.concat(chunks);
      return {
        markdown: content.toString('utf8'),
        version: new Date(file.updatedAt).toISOString(),
      };
    }
    const page = await this.rag.getPageInfo(scope, hit.pageId);
    if (
      hit.sourceType === 'page' &&
      page.type === 'database' &&
      page.databaseId
    ) {
      const database = await this.rag.getDatabaseSyncMetadata(
        scope,
        page.databaseId,
      );
      return database.documentEligible
        ? {
            markdown: database.knowledgeMarkdown,
            version: database.projectionUpdatedAt.toISOString(),
            headings: database.headingLocators,
          }
        : null;
    }
    if (hit.sourceType === 'database_row') {
      if (!page.databaseId) return null;
      const rows = await this.rag.getDatabaseRows(scope, page.databaseId, [
        hit.pageId,
      ]);
      const row = rows.items.find(
        (item) => item.id === hit.sourceId && !item.archivedAt,
      );
      return row
        ? {
            markdown: row.knowledgeMarkdown,
            version: new Date(row.projectionUpdatedAt).toISOString(),
            headings: row.headingLocators,
          }
        : null;
    }
    if (hit.sourceId !== hit.pageId) return null;
    return {
      markdown: page.knowledgeMarkdown ?? '',
      version: new Date(page.projectionUpdatedAt).toISOString(),
      headings: page.headingLocators,
    };
  }
}
