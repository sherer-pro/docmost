import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type { Page, User } from '@docmost/db/types/entity.types';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import {
  collectTemplateFields,
  isTemplateFieldFilled,
  normalizeTemplateDraft,
  summarizeTemplateDiff,
} from '@docmost/editor-ext/server';

const PUBLISH_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class PageTemplatePublicationService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async buildPublishPreflight(
    template: Page,
    user: User,
    issueConfirmation: boolean,
    getLiveContent: (pageId: string, user: User) => Promise<unknown>,
    suppliedDraft?: unknown,
  ) {
    const draft = this.normalizeDraftForPublication(
      suppliedDraft ?? (await getLiveContent(template.id, user)),
    );
    const draftHash = hashProseMirrorJson(draft as any);
    const latest = await this.db
      .selectFrom('pageTemplateRevisions')
      .selectAll()
      .where('templatePageId', '=', template.id)
      .orderBy('revision', 'desc')
      .executeTakeFirst();
    const diff = summarizeTemplateDiff(
      latest?.content ?? { type: 'doc', content: [] },
      draft,
    );
    const removedFieldIds = new Set(
      diff.removedFields.map((field) => field.fieldId),
    );
    const instances = await this.db
      .selectFrom('pageTemplateInstances as instance')
      .innerJoin('pages as child', 'child.id', 'instance.childPageId')
      .select(['instance.id', 'instance.childPageId', 'child.content'])
      .where('instance.templatePageId', '=', template.id)
      .where('instance.instanceKind', '=', 'synced')
      .where('instance.status', 'in', ['active', 'syncing', 'error'])
      .where('child.deletedAt', 'is', null)
      .execute();
    let filledRemovedFieldInstanceCount = 0;
    for (const instance of instances) {
      const liveContent = await getLiveContent(
        instance.childPageId,
        user,
      ).catch(() => instance.content);
      const fields = collectTemplateFields(liveContent);
      if (
        [...removedFieldIds].some((fieldId) =>
          isTemplateFieldFilled(fields.get(fieldId)),
        )
      ) {
        filledRemovedFieldInstanceCount += 1;
      }
    }
    let confirmationToken: string | null = null;
    let confirmationExpiresAt: Date | null = null;
    const requiresDestructiveConfirmation =
      removedFieldIds.size > 0 && instances.length > 0;
    if (issueConfirmation && requiresDestructiveConfirmation) {
      confirmationExpiresAt = new Date(
        Date.now() + PUBLISH_CONFIRMATION_TTL_MS,
      );
      const confirmation = await this.db
        .insertInto('pageTemplatePublishConfirmations')
        .values({
          templatePageId: template.id,
          requestedById: user.id,
          draftHash,
          removedFieldIds: [...removedFieldIds] as any,
          filledInstanceCount: filledRemovedFieldInstanceCount,
          expiresAt: confirmationExpiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      confirmationToken = confirmation.id;
    }
    return {
      draftHash,
      nextRevision: Number(latest?.revision ?? 0) + 1,
      diff,
      activeInstanceCount: instances.length,
      filledRemovedFieldInstanceCount,
      requiresDestructiveConfirmation,
      confirmationToken,
      confirmationExpiresAt: confirmationExpiresAt?.toISOString() ?? null,
    };
  }

  serializeRevision(revision: any, includeContent = false) {
    return {
      id: revision.id,
      templatePageId: revision.templatePageId,
      revision: revision.revision,
      contentHash: revision.contentHash,
      publishedById: revision.publishedById,
      createdAt: new Date(revision.createdAt).toISOString(),
      ...(includeContent ? { content: revision.content } : {}),
    };
  }

  normalizeDraftForPublication(content: unknown): unknown {
    const seed = this.hashRequest(content);
    let index = 0;
    return normalizeTemplateDraft(content, () => {
      const hex = createHash('sha256')
        .update(`${seed}:${index++}`)
        .digest('hex')
        .slice(0, 32);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    });
  }

  serializeSyncRun(run: any) {
    return {
      id: run.id,
      templatePageId: run.templatePageId,
      revision: run.revision,
      status: run.status,
      totalCount: Number(run.totalCount),
      processedCount: Number(run.processedCount),
      succeededCount: Number(run.succeededCount),
      failedCount: Number(run.failedCount),
      errorCode: run.errorCode,
      startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
      completedAt: run.completedAt
        ? new Date(run.completedAt).toISOString()
        : null,
      createdAt: new Date(run.createdAt).toISOString(),
    };
  }

  private hashRequest(request: unknown): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
  }
}
