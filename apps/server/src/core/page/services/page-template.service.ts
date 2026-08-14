import { Injectable } from '@nestjs/common';
import type { User } from '@docmost/db/types/entity.types';
import {
  CreateFromTemplateDto,
  CreatePageTemplateDto,
  DetachPageEmbedDto,
  DetachSyncedTemplateDto,
  InsertPageEmbedDto,
  PageTemplateDestinationsDto,
  PageTemplateDiscoveryDto,
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

  createTemplate(dto: CreatePageTemplateDto, user: User) {
    return this.instances.createTemplate(dto, user);
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

  listUsages(pageId: string, user: User) {
    return this.instances.listUsages(pageId, user);
  }

  preflightPublish(pageId: string, user: User) {
    return this.sync.preflightPublish(pageId, user);
  }

  publish(pageId: string, dto: PublishPageTemplateDto, user: User) {
    return this.sync.publish(pageId, dto, user);
  }

  listRevisions(pageId: string, user: User) {
    return this.sync.listRevisions(pageId, user);
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
