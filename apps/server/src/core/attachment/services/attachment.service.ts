import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Readable } from 'stream';
import { StorageService } from '../../../integrations/storage/storage.service';
import { MultipartFile } from '@fastify/multipart';
import {
  getAttachmentFolderPath,
  PreparedFile,
  prepareFile,
  validateFileType,
} from '../attachment.utils';
import { v4 as uuid4, v7 as uuid7 } from 'uuid';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import {
  AttachmentType,
  CONTENT_INDEXABLE_EXTENSIONS,
  validImageExtensions,
} from '../attachment.constants';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { Attachment, User, Workspace } from '@docmost/db/types/entity.types';
import { InjectKysely } from 'nestjs-kysely';
import { executeTx } from '@docmost/db/utils';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { createByteCountingStream } from '../../../common/helpers/utils';
import {
  readMagicBytesFromStream,
  resolveTrustedMimeType,
  SAFE_FILE_VALIDATION_ERROR_MESSAGE,
  validateFileExtensionAndSignature,
} from '../../../common/helpers/file-validation';
import { QueueOutboxService } from '../../../integrations/queue/outbox/queue-outbox.service';

type LegacyAttachmentCleanupScope = 'page' | 'space' | 'user_avatar';

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);
  constructor(
    private readonly storageService: StorageService,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly spaceRepo: SpaceRepo,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
    @InjectQueue(QueueName.SEARCH_QUEUE) private searchQueue: Queue,
    @Optional()
    private readonly queueOutboxService?: QueueOutboxService,
  ) {}

  async uploadFile(opts: {
    filePromise: Promise<MultipartFile>;
    pageId: string;
    userId: string;
    spaceId: string;
    workspaceId: string;
    attachmentId?: string;
  }) {
    const { filePromise, pageId, spaceId, userId, workspaceId } = opts;
    const preparedFile: PreparedFile = await prepareFile(filePromise, {
      skipBuffer: true,
    });

    const fileSignatureBuffer = await readMagicBytesFromStream(
      preparedFile.multiPartFile.file,
    );

    await validateFileExtensionAndSignature({
      fileName: preparedFile.fileName,
      fileBuffer: fileSignatureBuffer,
      safeErrorMessage: SAFE_FILE_VALIDATION_ERROR_MESSAGE,
    });
    preparedFile.mimeType = resolveTrustedMimeType({
      fileExtension: preparedFile.fileExtension,
      fileBuffer: fileSignatureBuffer,
      fallbackMimeType: preparedFile.mimeType,
    });

    let isUpdate = false;
    let attachmentId = null;
    let existingAttachment: Attachment | null = null;

    // passing attachmentId to allow for updating diagrams
    // instead of creating new files for each save
    if (opts?.attachmentId) {
      existingAttachment = await this.attachmentRepo.findById(
        opts.attachmentId,
      );
      if (!existingAttachment) {
        throw new NotFoundException(
          'Existing attachment to overwrite not found',
        );
      }

      // Validate each invariant separately and block overwrite on any mismatch.
      const isWorkspaceMismatch =
        existingAttachment.workspaceId !== workspaceId;
      const isPageMismatch = existingAttachment.pageId !== pageId;
      const isExtensionMismatch =
        existingAttachment.fileExt !== preparedFile.fileExtension;

      if (isWorkspaceMismatch || isPageMismatch || isExtensionMismatch) {
        throw new ForbiddenException('File attachment does not match');
      }
      attachmentId = opts.attachmentId;
      isUpdate = true;
    } else {
      attachmentId = uuid7();
    }

    const filePath = `${getAttachmentFolderPath(AttachmentType.File, workspaceId)}/${attachmentId}/${preparedFile.fileName}`;

    const { stream, getBytesRead } = createByteCountingStream(
      preparedFile.multiPartFile.file,
    );

    await this.uploadToDrive(filePath, stream);

    // Update fileSize from the consumed stream
    preparedFile.fileSize = getBytesRead();

    let attachment: Attachment = null;
    try {
      if (isUpdate) {
        attachment = await this.attachmentRepo.updateAttachment(
          {
            filePath,
            fileName: preparedFile.fileName,
            fileSize: preparedFile.fileSize,
            mimeType: preparedFile.mimeType,
            fileExt: preparedFile.fileExtension,
            textContent: null,
            contentIndexStatus: this.initialContentIndexStatus(
              preparedFile.fileExtension,
            ),
            contentIndexError: null,
            contentIndexStartedAt: null,
            contentIndexedAt: null,
            contentIndexVersion: null,
            updatedAt: new Date(),
          },
          attachmentId,
        );
      } else {
        attachment = await this.saveAttachment({
          attachmentId,
          preparedFile,
          filePath,
          type: AttachmentType.File,
          userId,
          spaceId,
          workspaceId,
          pageId,
        });
      }
    } catch {
      this.logger.error({ event: 'attachment_metadata_persist_failed' });

      if (
        !isUpdate ||
        !existingAttachment?.filePath ||
        existingAttachment.filePath !== filePath
      ) {
        await this.deleteRedundantFile(filePath);
      }

      throw new BadRequestException('Failed to upload file');
    }

    if (
      isUpdate &&
      existingAttachment?.filePath &&
      existingAttachment.filePath !== filePath
    ) {
      await this.deleteRedundantFile(existingAttachment.filePath);
    }

    if (this.initialContentIndexStatus(attachment.fileExt) === 'pending') {
      try {
        await this.attachmentQueue.add(
          QueueJob.ATTACHMENT_INDEX_CONTENT,
          {
            attachmentId: attachmentId,
          },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 10000,
            },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      } catch {
        this.logger.error({ event: 'attachment_content_enqueue_failed' });
      }
    }

    try {
      await this.searchQueue.add(
        QueueJob.SEARCH_INDEX_ATTACHMENT,
        { attachmentIds: [attachment.id] },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch {
      this.logger.error({ event: 'attachment_search_enqueue_failed' });
    }

    return attachment;
  }

  async uploadImage(
    filePromise: Promise<MultipartFile>,
    type:
      | AttachmentType.Avatar
      | AttachmentType.WorkspaceIcon
      | AttachmentType.SpaceIcon,
    userId: string,
    workspaceId: string,
    spaceId?: string,
  ) {
    const preparedFile: PreparedFile = await prepareFile(filePromise);
    validateFileType(preparedFile.fileExtension, validImageExtensions);

    await validateFileExtensionAndSignature({
      fileName: preparedFile.fileName,
      fileBuffer: preparedFile.buffer,
      allowedExtensions: validImageExtensions,
      safeErrorMessage: SAFE_FILE_VALIDATION_ERROR_MESSAGE,
    });
    preparedFile.mimeType = resolveTrustedMimeType({
      fileExtension: preparedFile.fileExtension,
      fileBuffer: preparedFile.buffer,
      fallbackMimeType: preparedFile.mimeType,
    });

    preparedFile.fileName = uuid4() + preparedFile.fileExtension;

    const filePath = `${getAttachmentFolderPath(type, workspaceId)}/${preparedFile.fileName}`;

    await this.uploadToDrive(filePath, preparedFile.buffer);

    let attachment: Attachment = null;
    let oldFileName: string = null;

    try {
      await executeTx(this.db, async (trx) => {
        attachment = await this.saveAttachment({
          preparedFile,
          filePath,
          type,
          userId,
          workspaceId,
          trx,
        });

        if (type === AttachmentType.Avatar) {
          const user = await this.userRepo.findById(userId, workspaceId, {
            trx,
          });

          oldFileName = user.avatarUrl;

          await this.userRepo.updateUser(
            { avatarUrl: preparedFile.fileName },
            userId,
            workspaceId,
            trx,
          );
        } else if (type === AttachmentType.WorkspaceIcon) {
          const workspace = await this.workspaceRepo.findById(workspaceId, {
            trx,
          });

          oldFileName = workspace.logo;

          await this.workspaceRepo.updateWorkspace(
            { logo: preparedFile.fileName },
            workspaceId,
            trx,
          );
        } else if (type === AttachmentType.SpaceIcon && spaceId) {
          const space = await this.spaceRepo.findById(spaceId, workspaceId, {
            trx,
          });

          oldFileName = space.logo;

          await this.spaceRepo.updateSpace(
            { logo: preparedFile.fileName },
            spaceId,
            workspaceId,
            trx,
          );
        } else {
          throw new BadRequestException(`Image upload aborted.`);
        }
      });
    } catch (err) {
      // delete uploaded file on db update failure
      await this.deleteRedundantFile(filePath);
      throw new BadRequestException('Failed to upload image');
    }

    if (oldFileName && !oldFileName.toLowerCase().startsWith('http')) {
      // delete old avatar or logo
      const oldFilePath =
        getAttachmentFolderPath(type, workspaceId) + '/' + oldFileName;
      await this.deleteRedundantFile(oldFilePath);
    }

    return attachment;
  }

  async deleteRedundantFile(filePath: string) {
    try {
      await this.storageService.delete(filePath);
      await this.attachmentRepo.deleteAttachmentByFilePath(filePath);
    } catch {
      this.logger.error({ event: 'attachment_redundant_delete_failed' });
    }
  }

  async uploadToDrive(filePath: string, fileContent: Buffer | Readable) {
    try {
      await this.storageService.upload(filePath, fileContent);
    } catch {
      this.logger.error({ event: 'attachment_storage_upload_failed' });
      throw new BadRequestException('Error uploading file to drive');
    }
  }

  async saveAttachment(opts: {
    attachmentId?: string;
    preparedFile: PreparedFile;
    filePath: string;
    type: AttachmentType;
    userId: string;
    workspaceId: string;
    pageId?: string;
    spaceId?: string;
    trx?: KyselyTransaction;
  }): Promise<Attachment> {
    const {
      attachmentId,
      preparedFile,
      filePath,
      type,
      userId,
      workspaceId,
      pageId,
      spaceId,
      trx,
    } = opts;
    return this.attachmentRepo.insertAttachment(
      {
        id: attachmentId,
        type: type,
        filePath: filePath,
        fileName: preparedFile.fileName,
        fileSize: preparedFile.fileSize,
        mimeType: preparedFile.mimeType,
        fileExt: preparedFile.fileExtension,
        creatorId: userId,
        workspaceId: workspaceId,
        pageId: pageId,
        spaceId: spaceId,
        contentIndexStatus: this.initialContentIndexStatus(
          preparedFile.fileExtension,
        ),
      },
      trx,
    );
  }

  /**
   * Only formats the extractor understands enter the content indexing pipeline.
   */
  private initialContentIndexStatus(fileExtension: string): string | null {
    return CONTENT_INDEXABLE_EXTENSIONS.includes(
      fileExtension?.toLowerCase() as (typeof CONTENT_INDEXABLE_EXTENSIONS)[number],
    )
      ? 'pending'
      : null;
  }

  async handleDeleteSpaceAttachments(spaceId: string) {
    await this.stageLegacyAttachmentCleanup('space', spaceId);
  }

  async handleDeleteUserAvatars(userId: string) {
    await this.stageLegacyAttachmentCleanup('user_avatar', userId);
  }

  async handleDeletePageAttachments(pageId: string) {
    await this.stageLegacyAttachmentCleanup('page', pageId);
  }

  private async stageLegacyAttachmentCleanup(
    scopeType: LegacyAttachmentCleanupScope,
    scopeId: string,
  ): Promise<void> {
    const queueOutbox = this.queueOutboxService;
    if (!queueOutbox) {
      throw new Error('attachment_cleanup_outbox_unavailable');
    }

    let staged = false;
    await executeTx(this.db, async (trx) => {
      let query = trx
        .selectFrom('attachments')
        .select(['id', 'workspaceId']);
      if (scopeType === 'page') {
        query = query.where('pageId', '=', scopeId);
      } else if (scopeType === 'space') {
        query = query.where('spaceId', '=', scopeId);
      } else {
        query = query
          .where('creatorId', '=', scopeId)
          .where('type', '=', AttachmentType.Avatar);
      }

      const attachments = await query.forUpdate().execute();
      if (attachments.length === 0) return;

      const workspaceIds = [
        ...new Set(attachments.map(({ workspaceId }) => workspaceId)),
      ];
      if (workspaceIds.length !== 1) {
        throw new Error('legacy_attachment_cleanup_workspace_mismatch');
      }

      const workspaceId = workspaceIds[0];
      if (scopeType === 'page') {
        staged = await queueOutbox.enqueuePageAttachmentCleanup(
          [scopeId],
          scopeId,
          workspaceId,
          trx,
        );
      } else if (scopeType === 'space') {
        staged = await queueOutbox.enqueueSpaceAttachmentCleanup(
          scopeId,
          workspaceId,
          trx,
        );
      } else {
        staged = await queueOutbox.enqueueUserAvatarCleanup(
          scopeId,
          workspaceId,
          trx,
        );
      }

      if (!staged) {
        throw new Error('legacy_attachment_cleanup_not_staged');
      }
    });

    if (staged) queueOutbox.kick();
  }

  async removeUserAvatar(user: User) {
    if (user.avatarUrl && !user.avatarUrl.toLowerCase().startsWith('http')) {
      const filePath = `${getAttachmentFolderPath(AttachmentType.Avatar, user.workspaceId)}/${user.avatarUrl}`;
      await this.deleteRedundantFile(filePath);
    }

    await this.userRepo.updateUser(
      { avatarUrl: null },
      user.id,
      user.workspaceId,
    );
  }

  async removeSpaceIcon(spaceId: string, workspaceId: string) {
    const space = await this.spaceRepo.findById(spaceId, workspaceId);

    if (!space) {
      throw new NotFoundException('Space not found');
    }

    if (space.logo && !space.logo.toLowerCase().startsWith('http')) {
      const filePath = `${getAttachmentFolderPath(AttachmentType.SpaceIcon, workspaceId)}/${space.logo}`;
      await this.deleteRedundantFile(filePath);
    }

    await this.spaceRepo.updateSpace({ logo: null }, spaceId, workspaceId);
  }

  async removeWorkspaceIcon(workspace: Workspace) {
    if (workspace.logo && !workspace.logo.toLowerCase().startsWith('http')) {
      const filePath = `${getAttachmentFolderPath(AttachmentType.WorkspaceIcon, workspace.id)}/${workspace.logo}`;
      await this.deleteRedundantFile(filePath);
    }

    await this.workspaceRepo.updateWorkspace({ logo: null }, workspace.id);
  }
}
