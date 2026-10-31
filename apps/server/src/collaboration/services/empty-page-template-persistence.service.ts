import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { isEmptyTemplateTarget } from '@docmost/editor-ext/server';
import type { KyselyTransaction } from '@docmost/db/types/kysely.types';
import type { Page, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../core/page-access/page-access.service';
import { PageTemplatePolicyService } from '../../core/page/transclusion/page-template-policy.service';
import { hashPageTemplateInstanceContent } from '../../common/helpers/prosemirror/page-template-content-hash';

@Injectable()
export class EmptyPageTemplatePersistenceService {
  constructor(
    private readonly access: PageAccessService,
    private readonly policy: PageTemplatePolicyService,
  ) {}

  async apply(
    trx: KyselyTransaction,
    target: Page,
    operation: any,
    actor: Pick<User, 'id'>,
  ) {
    const user = await trx.selectFrom('users').selectAll()
      .where('id', '=', actor.id).where('workspaceId', '=', target.workspaceId)
      .where('deletedAt', 'is', null).executeTakeFirst();
    if (!user) throw new ForbiddenException();
    const metadata = operation.applyMetadata;
    const conflict = () =>
      new ConflictException({
        code: 'page_template_apply_conflict',
        message: 'The template, access or target changed before application',
      });
    if (
      !metadata ||
      !['regular', 'synced'].includes(metadata.kind) ||
      !isEmptyTemplateTarget(target.content) ||
      target.templateKind
    )
      throw conflict();
    await this.access.assertCanWritePage(target, user);
    const source = await trx
      .selectFrom('pages')
      .selectAll()
      .where('id', '=', operation.sourcePageId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !source ||
      source.deletedAt ||
      source.templateArchivedAt ||
      source.workspaceId !== user.workspaceId ||
      source.spaceId !== target.spaceId ||
      source.templateKind !== metadata.kind
    )
      throw conflict();
    await this.access.assertCanReadPage(source, user);
    await this.policy.assertAction(
      user.workspaceId,
      target.spaceId,
      user.id,
      metadata.kind === 'synced'
        ? 'use_synced_template'
        : 'use_regular_template',
    );
    if (metadata.kind === 'synced') {
      const revision = await trx
        .selectFrom('pageTemplateRevisions')
        .select(['revision', 'contentHash'])
        .where('templatePageId', '=', source.id)
        .orderBy('revision', 'desc')
        .executeTakeFirst();
      if (
        !revision ||
        revision.revision !== metadata.revision ||
        revision.contentHash !== metadata.sourceHash
      )
        throw conflict();
    } else if (
      hashPageTemplateInstanceContent(source.content) !== metadata.sourceHash
    )
      throw conflict();
    const existing = await trx
      .selectFrom('pageTemplateInstances')
      .select('id')
      .where('childPageId', '=', target.id)
      .executeTakeFirst();
    if (existing) throw conflict();
    const rows = metadata.attachmentRows;
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          row.pageId !== target.id ||
          row.workspaceId !== user.workspaceId ||
          row.spaceId !== target.spaceId,
      )
    )
      throw conflict();
    const mapping = operation.attachmentMapping;
    if (
      !Array.isArray(mapping) ||
      mapping.length !== rows.length ||
      mapping.some(
        (item) => !rows.some((row) => row.id === item.newAttachmentId),
      )
    )
      throw conflict();
    if (rows.length) await trx.insertInto('attachments').values(rows).execute();
    const instance = await trx
      .insertInto('pageTemplateInstances')
      .values({
        workspaceId: user.workspaceId,
        spaceId: target.spaceId,
        templatePageId: source.id,
        childPageId: target.id,
        instanceKind: metadata.kind,
        createdRevision: metadata.revision,
        appliedRevision: metadata.revision,
        status: metadata.kind === 'synced' ? 'active' : 'snapshot',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (metadata.kind === 'synced' && mapping.length) {
      await trx
        .insertInto('pageTemplateAttachmentMappings')
        .values(
          mapping.map((item) => ({
            instanceId: instance.id,
            sourceAttachmentId: item.oldAttachmentId,
            childAttachmentId: item.newAttachmentId,
          })),
        )
        .execute();
    }
  }
}
