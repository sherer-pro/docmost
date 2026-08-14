import { Injectable } from '@nestjs/common';
import type { User } from '@docmost/db/types/entity.types';
import {
  CreateFromTemplateDto,
  CreateIndependentPageCopyDto,
  CreatePageTemplateDto,
  DetachPageEmbedDto,
  DetachSyncedTemplateDto,
  InsertPageEmbedDto,
  PageTemplateDestinationsDto,
  PageTemplateDiscoveryDto,
  PageTemplatePaginationDto,
  PublishPageTemplateDto,
} from '../dto/page-template.dto';
import { PageEmbedCommandService } from './page-embed-command.service';
import { PageTemplateInstanceService } from './page-template-instance.service';
import { PageTemplateSyncService } from './page-template-sync.service';

@Injectable()
export class PageTemplateService {
  constructor(
    private readonly instances: PageTemplateInstanceService,
    private readonly sync: PageTemplateSyncService,
    private readonly pageEmbeds: PageEmbedCommandService,
  ) {}

  getProvenance(pageId: string, user: User) {
    return this.instances.getProvenance(pageId, user);
  }

  discover(dto: PageTemplateDiscoveryDto, user: User) {
    return this.instances.discover(dto, user);
  }

  getCapabilities(spaceId: string, user: User) {
    return this.instances.getCapabilities(spaceId, user);
  }

  createTemplate(
    dto: CreatePageTemplateDto,
    idempotencyKey: string,
    user: User,
  ) {
    return this.instances.createTemplate(dto, idempotencyKey, user);
  }

  listDestinations(dto: PageTemplateDestinationsDto, user: User) {
    return this.instances.listDestinations(dto, user);
  }

  createFromTemplate(
    dto: CreateFromTemplateDto,
    idempotencyKey: string,
    user: User,
  ) {
    return this.instances.createFromTemplate(dto, idempotencyKey, user);
  }

  listUsages(pageId: string, dto: PageTemplatePaginationDto, user: User) {
    return this.instances.listUsages(pageId, dto, user);
  }

  preflightPublish(pageId: string, user: User) {
    return this.sync.preflightPublish(pageId, user);
  }

  publish(
    pageId: string,
    dto: PublishPageTemplateDto,
    idempotencyKey: string,
    user: User,
  ) {
    return this.sync.publish(pageId, dto, idempotencyKey, user);
  }

  listRevisions(pageId: string, dto: PageTemplatePaginationDto, user: User) {
    return this.sync.listRevisions(pageId, dto, user);
  }

  listSyncRuns(pageId: string, user: User) {
    return this.sync.listSyncRuns(pageId, user);
  }

  retrySyncRun(pageId: string, runId: string, user: User) {
    return this.sync.retrySyncRun(pageId, runId, user);
  }

  archive(pageId: string, user: User) {
    return this.instances.archive(pageId, user);
  }

  restore(pageId: string, user: User) {
    return this.instances.restore(pageId, user);
  }

  createIndependentCopy(
    pageId: string,
    dto: CreateIndependentPageCopyDto,
    idempotencyKey: string,
    user: User,
  ) {
    return this.instances.createIndependentCopy(
      pageId,
      dto,
      idempotencyKey,
      user,
    );
  }

  detachTemplate(
    pageId: string,
    dto: DetachSyncedTemplateDto,
    idempotencyKey: string,
    user: User,
  ) {
    return this.instances.detachTemplate(pageId, dto, idempotencyKey, user);
  }

  insertPageEmbed(dto: InsertPageEmbedDto, idempotencyKey: string, user: User) {
    return this.pageEmbeds.insertPageEmbed(dto, idempotencyKey, user);
  }

  detachPageEmbed(dto: DetachPageEmbedDto, idempotencyKey: string, user: User) {
    return this.pageEmbeds.detachPageEmbed(dto, idempotencyKey, user);
  }
}
