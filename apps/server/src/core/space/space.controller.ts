import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SpaceService } from './services/space.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SpaceIdDto } from './dto/space-id.dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { SpaceMemberService } from './services/space-member.service';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AddSpaceMembersDto } from './dto/add-space-members.dto';
import { RemoveSpaceMemberDto } from './dto/remove-space-member.dto';
import { UpdateSpaceMemberRoleDto } from './dto/update-space-member-role.dto';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { UpdateSpaceDto } from './dto/update-space.dto';
import { UpdateSpaceResourceDto } from './dto/update-space-resource.dto';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import { CreateSpaceDto } from './dto/create-space.dto';

@UseGuards(JwtAuthGuard)
@Controller('spaces')
export class SpaceController {
  constructor(
    private readonly spaceService: SpaceService,
    private readonly spaceMemberService: SpaceMemberService,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Get('/')
  async listSpaces(
    @Query()
    pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    return this.spaceMemberService.getUserSpaces(user.id, pagination);
  }

  @Get(':spaceId')
  async getSpace(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const space = await this.spaceService.getSpaceInfo(spaceId, workspace.id);

    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const ability = await this.spaceAbility.createForUser(user, space.id);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id,
      space.id,
    );

    const userSpaceRole = findHighestUserSpaceRole(userSpaceRoles);

    const membership = {
      userId: user.id,
      role: userSpaceRole,
      permissions: ability.rules,
    };

    return { ...space, membership };
  }

  /**
   * @deprecated Temporary backward-compatibility alias. Use GET /spaces/:spaceId.
   */
  @HttpCode(HttpStatus.OK)
  @Post('info')
  async getSpaceInfoAlias(
    @Body() spaceIdDto: SpaceIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getSpace(spaceIdDto.spaceId, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/')
  createSpace(
    @Body() createSpaceDto: CreateSpaceDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Space)
    ) {
      throw new ForbiddenException();
    }
    return this.spaceService.createSpace(user, workspace.id, createSpaceDto);
  }

  /**
   * @deprecated Temporary backward-compatibility alias. Use POST /spaces.
   */
  @HttpCode(HttpStatus.OK)
  @Post('create')
  createSpaceAlias(
    @Body() createSpaceDto: CreateSpaceDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.createSpace(createSpaceDto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':spaceId')
  async updateSpace(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() updateSpaceDto: UpdateSpaceResourceDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return this.spaceService.updateSpace(
      { ...updateSpaceDto, spaceId },
      workspace.id,
    );
  }

  /**
   * @deprecated Temporary backward-compatibility alias. Use PATCH /spaces/:spaceId.
   */
  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateSpaceAlias(
    @Body() updateSpaceDto: UpdateSpaceDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.updateSpace(
      updateSpaceDto.spaceId,
      updateSpaceDto,
      user,
      workspace,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':spaceId')
  async deleteSpace(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return this.spaceService.deleteSpace(spaceId, workspace.id);
  }

  /**
   * @deprecated Temporary backward-compatibility alias. Use DELETE /spaces/:spaceId.
   */
  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async deleteSpaceAlias(
    @Body() spaceIdDto: SpaceIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.deleteSpace(spaceIdDto.spaceId, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('member-users')
  async getSpaceMemberUsers(
    @Body() spaceIdDto: SpaceIdDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(
      user,
      spaceIdDto.spaceId,
    );

    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.spaceMemberService.getSpaceUserMembers(
      spaceIdDto.spaceId,
      workspace.id,
      pagination,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('members')
  async getSpaceMembers(
    @Body() spaceIdDto: SpaceIdDto,
    @Body()
    pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(
      user,
      spaceIdDto.spaceId,
    );

    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.spaceMemberService.getSpaceMembers(
      spaceIdDto.spaceId,
      workspace.id,
      pagination,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/add')
  async addSpaceMember(
    @Body() dto: AddSpaceMembersDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (
      (!dto.userIds || dto.userIds.length === 0) &&
      (!dto.groupIds || dto.groupIds.length === 0)
    ) {
      throw new BadRequestException('userIds or groupIds is required');
    }

    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.spaceMemberService.addMembersToSpaceBatch(
      dto,
      user,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/remove')
  async removeSpaceMember(
    @Body() dto: RemoveSpaceMemberDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.validateIds(dto);

    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.spaceMemberService.removeMemberFromSpace(dto, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/change-role')
  async updateSpaceMemberRole(
    @Body() dto: UpdateSpaceMemberRoleDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.validateIds(dto);

    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.spaceMemberService.updateSpaceMemberRole(dto, workspace.id);
  }

  validateIds(dto: RemoveSpaceMemberDto | UpdateSpaceMemberRoleDto) {
    if (!dto.userId && !dto.groupId) {
      throw new BadRequestException('userId or groupId is required');
    }
    if (dto.userId && dto.groupId) {
      throw new BadRequestException(
        'please provide either a userId or groupId and both',
      );
    }
  }
}
