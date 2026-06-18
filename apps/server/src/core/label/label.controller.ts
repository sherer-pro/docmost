import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { LabelRepo, LabelType } from '@docmost/db/repos/label/label.repo';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { LabelService } from './label.service';
import {
  FindPagesByLabelRequestDto,
  ListLabelsRequestDto,
} from './dto/label.dto';

@UseGuards(JwtAuthGuard)
@Controller('labels')
export class LabelController {
  constructor(
    private readonly labelService: LabelService,
    private readonly labelRepo: LabelRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('/')
  async getLabels(
    @Body() dto: ListLabelsRequestDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.labelService.getLabels(
      workspace.id,
      user.id,
      dto.type,
      dto,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('pages')
  async findPagesByLabel(
    @Body() dto: FindPagesByLabelRequestDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (dto.spaceId) {
      await this.assertCanReadSpace(user, dto.spaceId);
    }

    let labelId = dto.labelId;
    if (!labelId) {
      if (!dto.name) {
        throw new BadRequestException('labelId or name is required');
      }

      const label = await this.labelRepo.findByNameAndWorkspace(
        dto.name,
        workspace.id,
        LabelType.PAGE,
      );
      if (!label) {
        return this.emptyResult(dto.limit);
      }
      labelId = label.id;
    } else {
      const label = await this.labelRepo.findById(labelId);
      if (!label || label.workspaceId !== workspace.id) {
        throw new NotFoundException('Label not found');
      }
    }

    return this.labelService.findPagesByLabel(labelId, user, {
      spaceId: dto.spaceId,
      query: dto.query,
      pagination: dto,
    });
  }

  private async assertCanReadSpace(user: User, spaceId: string): Promise<void> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  private emptyResult(limit: number) {
    return {
      items: [],
      meta: {
        limit,
        hasNextPage: false,
        hasPrevPage: false,
        nextCursor: null,
        prevCursor: null,
      },
    };
  }
}
