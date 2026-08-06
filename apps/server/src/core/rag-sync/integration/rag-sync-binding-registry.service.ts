import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RagSyncAdminRepo } from '../admin/rag-sync-admin.repo';
import {
  RagSyncBindingRegistry,
  RagSyncRuntimeBinding,
} from '../runtime/rag-sync-runtime.types';

@Injectable()
export class RagSyncBindingRegistryService implements RagSyncBindingRegistry {
  private readonly logger = new Logger(RagSyncBindingRegistryService.name);

  constructor(private readonly repo: RagSyncAdminRepo) {}

  async listRunnableBindings(): Promise<RagSyncRuntimeBinding[]> {
    const rows = await this.repo.listRunnableBindings();
    const bindings: RagSyncRuntimeBinding[] = [];
    for (const row of rows) {
      if (
        row.adapter !== 'open-webui-knowledge-v1' ||
        !row.baseUrl ||
        !row.knowledgeId ||
        !row.writerApiKeyEncrypted ||
        !row.targetClaimId ||
        (row.state !== 'enabled' && row.state !== 'draining')
      ) {
        this.logger.warn('Skipped an incomplete RAG sync binding');
        continue;
      }
      let targetFingerprint: string;
      try {
        targetFingerprint = createHash('sha256')
          .update(
            `${new URL(row.baseUrl).origin.toLowerCase()}\n${row.knowledgeId}`,
          )
          .digest('hex');
      } catch {
        this.logger.warn('Skipped a RAG sync binding with an invalid target');
        continue;
      }
      if (!(await this.repo.hasActiveClaim(row, targetFingerprint))) {
        this.logger.warn('Skipped a RAG sync binding with an invalid claim');
        continue;
      }
      bindings.push({
        id: row.id,
        workspaceId: row.workspaceId,
        spaceId: row.spaceId,
        state: row.state,
        adapter: 'open-webui-knowledge-v1',
        baseUrl: row.baseUrl,
        knowledgeId: row.knowledgeId,
        configVersion: row.configVersion,
        targetVersion: row.targetVersion,
        updatedAtMs: row.updatedAt.getTime(),
      });
    }
    return bindings;
  }

  async completeDrain(
    bindingId: string,
    expectedConfigVersion: number,
    expectedTargetVersion: number,
  ): Promise<void> {
    await this.repo.completeCleanup(
      bindingId,
      expectedConfigVersion,
      expectedTargetVersion,
    );
  }
}
