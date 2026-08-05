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
  Req,
  UseGuards,
} from '@nestjs/common';
import { SpaceService } from './services/space.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  SpaceIdDto,
  SpaceMembersQueryDto,
  SpacePolicyContextQueryDto,
} from './dto/space-id.dto';
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
import { UpdateSpaceResourceDto } from './dto/update-space-resource.dto';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import { CreateSpaceDto } from './dto/create-space.dto';
import { PageAccessService } from '../page-access/page-access.service';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';
import { FastifyRequest } from 'fastify';
import { SpacePolicyService } from '../space-policy/space-policy.service';
import type { SpacePolicyContext } from '@docmost/api-contract';

@UseGuards(JwtAuthGuard)
@Controller('spaces')
export class SpaceController {
  constructor(
    private readonly spaceService: SpaceService,
    private readonly spaceMemberService: SpaceMemberService,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
    private readonly spacePolicy: SpacePolicyService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('bootstrap')
  @Get('/')
  async listSpaces(
    @Query()
    pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ) {
    return this.spaceMemberService.getUserSpaces(
      user,
      workspace,
      (req as any).user?.session ?? (req.raw as any).userSession,
      pagination,
    );
  }

  @AuthPolicyScope('bootstrap')
  @Get('policy-context')
  async getSpacePolicyContext(
    @Query() query: SpacePolicyContextQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ): Promise<SpacePolicyContext> {
    const target = await this.spacePolicy.resolveAccessibleSpace(
      workspace,
      user,
      query.spaceSlug,
    );
    if (!target) {
      throw new NotFoundException('Space not found');
    }

    const session =
      (req as any).user?.session ?? (req.raw as any).userSession;
    const authentication = this.spacePolicy.evaluateAuthentication(
      target.policy.effective,
      session,
    );

    return {
      id: target.space.id,
      slug: target.space.slug,
      name: target.space.name,
      policy: target.policy,
      requiresStepUp: !authentication.satisfied,
    };
  }

  @AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
  @Get(':spaceId')
  async getSpace(
    @Param('spaceId') spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const space = await this.spaceService.getSpaceInfo(spaceId, workspace.id);

    if (!space) {
      throw new NotFoundException('Space not found');
    }

    try {
      const ability = await this.spaceAbility.createForUser(user, space.id);
      if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Settings)) {
        throw new ForbiddenException();
      }

      const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
        user.id,
        space.id,
      );

      const userSpaceRole = findHighestUserSpaceRole(userSpaceRoles) ?? null;

      const membership = {
        userId: user.id,
        role: userSpaceRole,
        permissions: ability.rules,
        isPageOnly: false,
      };

      return { ...space, membership };
    } catch (err) {
      const hasReadablePages =
        await this.pageAccessService.hasAnyReadablePageInSpace(user, space.id);
      if (!hasReadablePages) {
        throw err;
      }

      return {
        ...space,
        membership: {
          userId: user.id,
          role: 'reader',
          permissions: [],
          isPageOnly: true,
        },
      };
    }
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

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
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
      {
        canLoosenPolicy:
          user.role === 'owner' || user.role === 'admin',
      },
    );
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
  @Post(':spaceId/actions/archive')
  async archiveSpace(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    await this.spaceService.archiveSpace(spaceId, workspace.id);
    return this.getSpace(spaceId, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
  @Post(':spaceId/actions/unarchive')
  async unarchiveSpace(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    await this.spaceService.unarchiveSpace(spaceId, workspace.id);
    return this.getSpace(spaceId, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'params', key: 'spaceId' })
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

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'query', key: 'spaceId' })
  @Get('member-users')
  async getSpaceMemberUsersViaQuery(
    @Query() query: SpaceMembersQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getSpaceMemberUsers(query, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'query', key: 'spaceId' })
  @Get('members')
  async getSpaceMembersViaQuery(
    @Query() query: SpaceMembersQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getSpaceMembers(query, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
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
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
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
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
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

  async getSpaceMemberUsers(
    @Body() spaceIdDto: SpaceMembersQueryDto,
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
      spaceIdDto,
    );
  }

  async getSpaceMembers(
    @Body() spaceIdDto: SpaceMembersQueryDto,
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
      spaceIdDto,
    );
  }
}
