import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type { Page, User } from '@docmost/db/types/entity.types';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import { hashProseMirrorJson } from '../../../common/helpers/prosemirror/ai-page-operation';
import {
  collectTemplateFields,
  formatTemplateDraftId,
  isTemplateFieldFilled,
  normalizeTemplateDraft,
  serializeTemplateDraftSeed,
  summarizeTemplateDiff,
} from '@docmost/editor-ext/server';

const PUBLISH_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const DESTRUCTIVE_PREFLIGHT_LIVE_READ_LIMIT = 100;
const DESTRUCTIVE_PREFLIGHT_LIVE_READ_DEADLINE_MS = 5_000;
const DESTRUCTIVE_PREFLIGHT_TIMEOUT = Symbol('destructive-preflight-timeout');

type PublishConfirmationBasis = {
  version: 1;
  latestRevisionId: string | null;
  latestRevision: number | null;
  latestContentHash: string | null;
  removedFieldIds: string[];
};

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
    const removedFieldIds = this.canonicalRemovedFieldIds(
      diff.removedFields.map((field) => field.fieldId),
    );
    const instances =
      removedFieldIds.length === 0
        ? []
        : await this.db
            .selectFrom('pageTemplateInstances as instance')
            .innerJoin('pages as child', 'child.id', 'instance.childPageId')
            .select(['instance.id', 'instance.childPageId', 'child.content'])
            .where('instance.templatePageId', '=', template.id)
            .where('instance.instanceKind', '=', 'synced')
            .where('instance.status', 'in', ['active', 'syncing', 'error'])
            .where('child.deletedAt', 'is', null)
            .limit(DESTRUCTIVE_PREFLIGHT_LIVE_READ_LIMIT)
            .execute();
    const activeInstanceCount = await this.countActiveInstances(template.id);
    const sampledFilledRemovedFields =
      removedFieldIds.length > 0
        ? await this.countFilledRemovedFields(
            instances,
            removedFieldIds,
            user,
            getLiveContent,
          )
        : { count: 0, exact: true };
    const filledRemovedFieldInstanceCount =
      removedFieldIds.length > 0
        ? Math.min(
            activeInstanceCount,
            sampledFilledRemovedFields.count +
              Math.max(0, activeInstanceCount - instances.length),
          )
        : 0;
    const filledRemovedFieldInstanceCountExact =
      removedFieldIds.length === 0 ||
      (sampledFilledRemovedFields.exact &&
        instances.length >= activeInstanceCount);
    let confirmationToken: string | null = null;
    let confirmationExpiresAt: Date | null = null;
    const requiresDestructiveConfirmation =
      removedFieldIds.length > 0 && activeInstanceCount > 0;
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
          removedFieldIds: this.createConfirmationBasis(
            latest,
            removedFieldIds,
          ) as any,
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
      activeInstanceCount,
      filledRemovedFieldInstanceCount,
      filledRemovedFieldInstanceCountExact,
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
    const seed = this.hashSeed(serializeTemplateDraftSeed(content));
    let index = 0;
    return normalizeTemplateDraft(content, () => {
      const digest = createHash('sha256')
        .update(`${seed}:${index++}`)
        .digest('hex');
      return formatTemplateDraftId(digest);
    });
  }

  isConfirmationBasisValid(
    storedBasis: unknown,
    latest: any,
    draft: unknown,
  ): boolean {
    if (
      !storedBasis ||
      typeof storedBasis !== 'object' ||
      Array.isArray(storedBasis)
    ) {
      return false;
    }
    const stored = storedBasis as Record<string, unknown>;
    if (
      stored.version !== 1 ||
      !Array.isArray(stored.removedFieldIds) ||
      stored.removedFieldIds.some((fieldId) => typeof fieldId !== 'string')
    ) {
      return false;
    }
    const diff = summarizeTemplateDiff(
      latest?.content ?? { type: 'doc', content: [] },
      draft,
    );
    const expected = this.createConfirmationBasis(
      latest,
      diff.removedFields.map((field) => field.fieldId),
    );
    return (
      stored.latestRevisionId === expected.latestRevisionId &&
      stored.latestRevision === expected.latestRevision &&
      stored.latestContentHash === expected.latestContentHash &&
      stored.removedFieldIds.length === expected.removedFieldIds.length &&
      stored.removedFieldIds.every(
        (fieldId, index) => fieldId === expected.removedFieldIds[index],
      )
    );
  }

  private async countFilledRemovedFields(
    instances: Array<{ childPageId: string; content: unknown }>,
    fieldIds: string[],
    user: User,
    getLiveContent: (pageId: string, user: User) => Promise<unknown>,
  ): Promise<{ count: number; exact: boolean }> {
    let nextIndex = 0;
    let processedCount = 0;
    let filledCount = 0;
    let exact = true;
    let deadlineExpired = false;
    const deadline =
      Date.now() + DESTRUCTIVE_PREFLIGHT_LIVE_READ_DEADLINE_MS;
    const workerCount = Math.min(5, instances.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        if (deadlineExpired) return;
        const index = nextIndex;
        nextIndex += 1;
        if (index >= instances.length) return;
        const instance = instances[index];
        let content = instance.content;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          deadlineExpired = true;
          exact = false;
          return;
        }
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          content =
            (await Promise.race([
              getLiveContent(instance.childPageId, user),
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                  () => reject(DESTRUCTIVE_PREFLIGHT_TIMEOUT),
                  remainingMs,
                );
                timeout.unref?.();
              }),
            ])) ??
            instance.content;
          processedCount += 1;
        } catch (error) {
          if (error === DESTRUCTIVE_PREFLIGHT_TIMEOUT) {
            deadlineExpired = true;
            exact = false;
            return;
          }
          // Persisted content remains the recovery snapshot, but a failed live
          // read is conservatively counted because unflushed values may exist.
          processedCount += 1;
          filledCount += 1;
          exact = false;
          continue;
        } finally {
          if (timeout) clearTimeout(timeout);
        }
        try {
          const fields = collectTemplateFields(content);
          if (
            fieldIds.some((fieldId) =>
              isTemplateFieldFilled(fields.get(fieldId)),
            )
          ) {
            filledCount += 1;
          }
        } catch {
          // An unreadable live snapshot is conservatively treated as populated.
          filledCount += 1;
          exact = false;
        }
      }
    });
    await Promise.all(workers);
    return {
      count: filledCount + Math.max(0, instances.length - processedCount),
      exact: exact && processedCount === instances.length,
    };
  }

  private async countActiveInstances(templatePageId: string): Promise<number> {
    const result = await this.db
      .selectFrom('pageTemplateInstances as instance')
      .innerJoin('pages as child', 'child.id', 'instance.childPageId')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('instance.templatePageId', '=', templatePageId)
      .where('instance.instanceKind', '=', 'synced')
      .where('instance.status', 'in', ['active', 'syncing', 'error'])
      .where('child.deletedAt', 'is', null)
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  private createConfirmationBasis(
    latest: any,
    removedFieldIds: Iterable<string>,
  ): PublishConfirmationBasis {
    return {
      version: 1,
      latestRevisionId: typeof latest?.id === 'string' ? latest.id : null,
      latestRevision:
        latest?.revision === null || latest?.revision === undefined
          ? null
          : Number(latest.revision),
      latestContentHash:
        typeof latest?.contentHash === 'string' ? latest.contentHash : null,
      removedFieldIds: this.canonicalRemovedFieldIds(removedFieldIds),
    };
  }

  private canonicalRemovedFieldIds(fieldIds: Iterable<string>): string[] {
    return [...new Set(fieldIds)].sort();
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

  private hashSeed(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
