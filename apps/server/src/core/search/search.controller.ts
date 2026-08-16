import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SearchService } from './search.service';
import {
  SearchDTO,
  SearchShareDTO,
  SearchSuggestionDTO,
  SearchTagFacetDTO,
} from './dto/search.dto';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { PageAccessService } from '../page-access/page-access.service';
import { AuthRateLimitGuard } from '../auth/rate-limit/auth-rate-limit.guard';
import { AuthRateLimit } from '../auth/rate-limit/auth-rate-limit.decorator';
import { TypesenseSearchService } from './typesense-search.service';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';
import { FastifyReply } from 'fastify';

@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly typesenseSearchService: TypesenseSearchService,
    private readonly pageAccessService: PageAccessService,
    private readonly environmentService: EnvironmentService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'body',
    key: 'spaceId',
    optional: true,
  })
  @Post()
  async pageSearch(
    @Body() searchDto: SearchDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    delete searchDto.shareId;

    if (searchDto.spaceId) {
      const hasReadablePages =
        await this.pageAccessService.hasAnyReadablePageInSpace(
          user,
          searchDto.spaceId,
        );
      if (!hasReadablePages) {
        throw new ForbiddenException();
      }
    }

    if (
      this.environmentService.getSearchDriver() === 'typesense' &&
      !searchDto.labelId &&
      !searchDto.tag &&
      !searchDto.tags?.length
    ) {
      return this.typesenseSearchService.searchPages(searchDto, {
        userId: user.id,
        workspaceId: workspace.id,
      });
    }

    return this.searchService.searchPage(searchDto, {
      userId: user.id,
      workspaceId: workspace.id,
    });
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'body',
    key: 'spaceId',
    optional: true,
  })
  @Post('tag-facets')
  async tagFacets(
    @Body() dto: SearchTagFacetDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (dto.spaceId) {
      const hasReadablePages =
        await this.pageAccessService.hasAnyReadablePageInSpace(
          user,
          dto.spaceId,
        );
      if (!hasReadablePages) {
        throw new ForbiddenException();
      }
    }

    return this.searchService.getTagFacets(dto, {
      userId: user.id,
      workspaceId: workspace.id,
    });
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'body',
    key: 'spaceId',
    optional: true,
  })
  @Post('attachments')
  async attachmentSearch(
    @Body() searchDto: SearchDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    delete searchDto.shareId;
    delete searchDto.labelId;
    delete searchDto.tag;
    delete searchDto.tags;

    if (!searchDto.query?.trim()) {
      throw new BadRequestException('query is required');
    }

    if (searchDto.spaceId) {
      const hasReadablePages =
        await this.pageAccessService.hasAnyReadablePageInSpace(
          user,
          searchDto.spaceId,
        );
      if (!hasReadablePages) {
        throw new ForbiddenException();
      }
    }

    const search = {
      userId: user.id,
      workspaceId: workspace.id,
    };
    if (this.environmentService.getSearchDriver() === 'typesense') {
      return this.typesenseSearchService.searchAttachments(searchDto, search);
    }

    return this.searchService.searchAttachments(searchDto, search);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'query',
    key: 'spaceId',
    optional: true,
  })
  @Get('suggest')
  async searchSuggestionsViaQuery(
    @Query() dto: SearchSuggestionDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.searchSuggestions(dto, user, workspace);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('share-search')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'shareSearch', accountField: 'shareId' })
  async searchShare(
    @Body() searchDto: SearchShareDTO,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    res.header('Cache-Control', 'private, no-store');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    delete searchDto.spaceId;
    delete searchDto.labelId;
    delete searchDto.tag;
    delete searchDto.tags;
    if (!searchDto.shareId) {
      throw new BadRequestException('shareId is required');
    }
    if (!searchDto.query?.trim()) {
      throw new BadRequestException('query is required');
    }

    if (this.environmentService.getSearchDriver() === 'typesense') {
      return this.typesenseSearchService.searchPages(searchDto, {
        workspaceId: workspace.id,
      });
    }

    return this.searchService.searchPage(searchDto, {
      workspaceId: workspace.id,
    });
  }

  async searchSuggestions(
    @Body() dto: SearchSuggestionDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.searchService.searchSuggestions(dto, user, workspace.id);
  }
}
