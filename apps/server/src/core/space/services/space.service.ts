import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateSpaceDto } from '../dto/create-space.dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { Space, User } from '@docmost/db/types/entity.types';
import { UpdateSpaceDto } from '../dto/update-space.dto';
import { executeTx } from '@docmost/db/utils';
import { InjectKysely } from 'nestjs-kysely';
import { SpaceMemberService } from './space-member.service';
import { SpaceRole } from '../../../common/helpers/types/permission';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { CursorPaginationResult } from '@docmost/db/pagination/cursor-pagination';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';

@Injectable()
export class SpaceService {
  constructor(
    private spaceRepo: SpaceRepo,
    private spaceMemberService: SpaceMemberService,
    private shareRepo: ShareRepo,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
  ) {}

  async createSpace(
    authUser: User,
    workspaceId: string,
    createSpaceDto: CreateSpaceDto,
    trx?: KyselyTransaction,
  ): Promise<Space> {
    let space = null;

    await executeTx(
      this.db,
      async (trx) => {
        space = await this.create(
          authUser.id,
          workspaceId,
          createSpaceDto,
          trx,
        );

        await this.spaceMemberService.addUserToSpace(
          authUser.id,
          space.id,
          SpaceRole.ADMIN,
          workspaceId,
          trx,
        );
      },
      trx,
    );

    return { ...space, memberCount: 1 };
  }

  async create(
    userId: string,
    workspaceId: string,
    createSpaceDto: CreateSpaceDto,
    trx?: KyselyTransaction,
  ): Promise<Space> {
    const slugExists = await this.spaceRepo.slugExists(
      createSpaceDto.slug,
      workspaceId,
      trx,
    );
    if (slugExists) {
      throw new BadRequestException(
        'Space slug exists. Please use a unique space slug',
      );
    }

    return await this.spaceRepo.insertSpace(
      {
        name: createSpaceDto.name ?? 'untitled space',
        description: createSpaceDto.description ?? '',
        creatorId: userId,
        workspaceId: workspaceId,
        slug: createSpaceDto.slug,
      },
      trx,
    );
  }

  async updateSpace(
    updateSpaceDto: UpdateSpaceDto,
    workspaceId: string,
  ): Promise<Space> {
    if (updateSpaceDto?.slug) {
      const slugExists = await this.spaceRepo.slugExists(
        updateSpaceDto.slug,
        workspaceId,
      );

      if (slugExists) {
        throw new BadRequestException(
          'Space slug exists. Please use a unique space slug',
        );
      }
    }

    if (typeof updateSpaceDto.disablePublicSharing !== 'undefined') {
      await executeTx(this.db, async (trx) => {
        await this.spaceRepo.updateSharingSettings(
          updateSpaceDto.spaceId,
          workspaceId,
          'disabled',
          updateSpaceDto.disablePublicSharing,
          trx,
        );

        if (updateSpaceDto.disablePublicSharing) {
          await this.shareRepo.deleteBySpaceId(updateSpaceDto.spaceId, trx);
        }
      });
    }

    if (updateSpaceDto.documentFields) {
      await this.spaceRepo.updateDocumentFieldsSettings(
        updateSpaceDto.spaceId,
        workspaceId,
        updateSpaceDto.documentFields,
      );
    }

    if (typeof updateSpaceDto.dictionaryEnabled !== 'undefined') {
      await this.spaceRepo.updateDictionarySettings(
        updateSpaceDto.spaceId,
        workspaceId,
        { enabled: updateSpaceDto.dictionaryEnabled },
      );
    }

    if (typeof updateSpaceDto.headingNumberingEnabled !== 'undefined') {
      await this.spaceRepo.updateHeadingNumberingSettings(
        updateSpaceDto.spaceId,
        workspaceId,
        { enabled: updateSpaceDto.headingNumberingEnabled },
      );
    }

    if (updateSpaceDto.customLinks) {
      const links = (updateSpaceDto.customLinks.links ?? []).map((link) => ({
        id: link.id || randomUUID(),
        label: link.label.trim(),
        url: link.url.trim(),
        icon: link.icon,
      }));

      await this.spaceRepo.updateCustomLinksSettings(
        updateSpaceDto.spaceId,
        workspaceId,
        { links },
      );
    }

    return await this.spaceRepo.updateSpace(
      {
        name: updateSpaceDto.name,
        description: updateSpaceDto.description,
        slug: updateSpaceDto.slug,
      },
      updateSpaceDto.spaceId,
      workspaceId,
    );
  }

  async getSpaceInfo(spaceId: string, workspaceId: string): Promise<Space> {
    const space = await this.spaceRepo.findById(spaceId, workspaceId, {
      includeMemberCount: true,
    });
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    return space;
  }

  async archiveSpace(spaceId: string, workspaceId: string): Promise<Space> {
    const space = await this.spaceRepo.archiveSpace(spaceId, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    return space;
  }

  async unarchiveSpace(spaceId: string, workspaceId: string): Promise<Space> {
    const space = await this.spaceRepo.unarchiveSpace(spaceId, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    return space;
  }

  async getWorkspaceSpaces(
    workspaceId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Space>> {
    return this.spaceRepo.getSpacesInWorkspace(workspaceId, pagination);
  }

  async deleteSpace(spaceId: string, workspaceId: string): Promise<void> {
    const space = await this.spaceRepo.findById(spaceId, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    await this.spaceRepo.deleteSpace(spaceId, workspaceId);
    await this.attachmentQueue.add(QueueJob.DELETE_SPACE_ATTACHMENTS, space);
  }
}
