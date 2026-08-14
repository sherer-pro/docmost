import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Page, User } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import {
  COLLABORATION_DOCUMENT_PORT,
  CollaborationDocumentPort,
} from '../../../collaboration/collaboration-document.port';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { PageAccessService } from '../../page-access/page-access.service';

@Injectable()
export class PageTemplateContentService {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly databaseRepo: DatabaseRepo,
    private readonly databaseRowRepo: DatabaseRowRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
    @Inject(COLLABORATION_DOCUMENT_PORT)
    private readonly collaborationGateway: CollaborationDocumentPort,
  ) {}

  getLiveContent(pageId: string, user: User): Promise<any> {
    return this.collaborationGateway.getPageContent(`page.${pageId}`, {
      user,
    }) as Promise<any>;
  }

  applyMutation(
    pageId: string,
    originalContent: unknown,
    nextContent: unknown,
    baseContentHash: string,
    mutationId: string,
    operationLeaseToken: string,
    user: User,
    systemSyncRevision?: number,
  ): Promise<{ beforeHash: string; afterHash: string }> {
    return this.collaborationGateway.applyPageTemplateMutation(
      `page.${pageId}`,
      {
        originalContent,
        nextContent,
        baseContentHash,
        mutationId,
        operationLeaseToken,
        workspaceId: user.workspaceId,
        systemSyncRevision,
        user,
      },
    );
  }

  async requireTemplateSource(pageId: string, user: User): Promise<Page> {
    const page = await this.requirePlainDocument(pageId, user.workspaceId);
    await this.pageAccessService.assertCanReadPage(page, user);
    if (!page.templateKind) {
      throw new BadRequestException({
        code: 'page_template_marker_required',
        message: 'The source page is not a template',
      });
    }
    return page;
  }

  async requirePlainDocument(
    pageId: string,
    workspaceId: string,
  ): Promise<Page> {
    const page = await this.pageRepo.findById(pageId, { includeContent: true });
    if (!page || page.deletedAt || page.workspaceId !== workspaceId) {
      throw new NotFoundException('Page not found');
    }
    const [database, row] = await Promise.all([
      this.databaseRepo.findByPageId(page.id, workspaceId),
      this.databaseRowRepo.findActiveByPageId(page.id, workspaceId),
    ]);
    if (database || row) {
      throw new BadRequestException({
        code: 'page_template_document_only',
        message: 'Page templates support document pages only',
      });
    }
    return page;
  }

  async findReadablePlainDocument(
    pageId: string,
    user: User,
  ): Promise<Page | null> {
    let page: Page;
    try {
      page = await this.requirePlainDocument(pageId, user.workspaceId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        return null;
      }
      throw error;
    }
    const access = await this.pageAccessService.getEffectiveAccess(page, user);
    return access.capabilities.canRead ? page : null;
  }

  async assertCanCreate(
    spaceId: string,
    parentPageId: string | undefined,
    user: User,
  ): Promise<void> {
    if (parentPageId) {
      const parent = await this.requirePlainDocument(
        parentPageId,
        user.workspaceId,
      );
      if (parent.spaceId !== spaceId) {
        throw new NotFoundException('Parent page not found');
      }
      await this.pageAccessService.assertCanCreateChild(parent, user);
      return;
    }
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  async copyAttachments(
    copies: Array<{ oldAttachmentId: string; newAttachmentId: string }>,
    source: Page,
    targetPageId: string,
    targetSpaceId: string,
    user: User,
    copiedPaths: string[],
    insertRows: boolean,
  ): Promise<any[]> {
    if (copies.length === 0) return [];
    const originals = await this.attachmentRepo.findByIds(
      copies.map((copy) => copy.oldAttachmentId),
    );
    const byId = new Map(
      originals
        .filter((attachment) => attachment.pageId === source.id)
        .map((attachment) => [attachment.id, attachment]),
    );
    const rows: any[] = [];
    for (const copy of copies) {
      const original = byId.get(copy.oldAttachmentId);
      if (!original) {
        throw this.conflict(
          'page_template_attachment_unavailable',
          'A referenced attachment is unavailable',
        );
      }
      const filePath = original.filePath
        .split(copy.oldAttachmentId)
        .join(copy.newAttachmentId);
      await this.storageService.copy(original.filePath, filePath);
      copiedPaths.push(filePath);
      const row = {
        id: copy.newAttachmentId,
        type: original.type,
        filePath,
        fileName: original.fileName,
        fileSize: original.fileSize,
        mimeType: original.mimeType,
        fileExt: original.fileExt,
        creatorId: user.id,
        workspaceId: user.workspaceId,
        pageId: targetPageId,
        spaceId: targetSpaceId,
        textContent: original.textContent,
      };
      rows.push(row);
      if (insertRows) await this.attachmentRepo.insertAttachment(row);
    }
    return rows;
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
