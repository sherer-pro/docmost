import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SearchService } from './search.service';
import {
  SearchDTO,
  SearchShareDTO,
  SearchSuggestionDTO,
} from './dto/search.dto';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { ModuleRef } from '@nestjs/core';
import { PageAccessService } from '../page-access/page-access.service';
import { DeprecatedRoute } from '../../common/decorators/deprecated-route.decorator';
import { LEGACY_API_SUNSET } from '../../common/config/api-deprecation.constants';
import { AuthRateLimitGuard } from '../auth/rate-limit/auth-rate-limit.guard';
import { AuthRateLimit } from '../auth/rate-limit/auth-rate-limit.decorator';

@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly pageAccessService: PageAccessService,
    private readonly environmentService: EnvironmentService,
    private moduleRef: ModuleRef,
  ) {}

  @HttpCode(HttpStatus.OK)
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
      !searchDto.labelId
    ) {
      return this.searchTypesense(searchDto, {
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
  @Post('attachments')
  async attachmentSearch(
    @Body() searchDto: SearchDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    delete searchDto.shareId;
    delete searchDto.labelId;

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

    return this.searchService.searchAttachments(searchDto, {
      userId: user.id,
      workspaceId: workspace.id,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Get('suggest')
  async searchSuggestionsViaQuery(
    @Query() dto: SearchSuggestionDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.searchSuggestions(dto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @DeprecatedRoute({
    sunset: LEGACY_API_SUNSET,
    replacement: 'GET /api/search/suggest',
  })
  @Post('suggest')
  async searchSuggestions(
    @Body() dto: SearchSuggestionDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.searchService.searchSuggestions(dto, user, workspace.id);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('share-search')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({ endpoint: 'shareSearch', accountField: 'shareId' })
  async searchShare(
    @Body() searchDto: SearchShareDTO,
    @AuthWorkspace() workspace: Workspace,
  ) {
    delete searchDto.spaceId;
    delete searchDto.labelId;
    if (!searchDto.shareId) {
      throw new BadRequestException('shareId is required');
    }
    if (!searchDto.query?.trim()) {
      throw new BadRequestException('query is required');
    }

    if (this.environmentService.getSearchDriver() === 'typesense') {
      return this.searchTypesense(searchDto, {
        workspaceId: workspace.id,
      });
    }

    return this.searchService.searchPage(searchDto, {
      workspaceId: workspace.id,
    });
  }

  async searchTypesense(
    searchParams: SearchDTO,
    opts: {
      userId?: string;
      workspaceId: string;
    },
  ) {
    const { userId, workspaceId } = opts;
    let TypesenseModule: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      TypesenseModule = require('./../../ee/typesense/services/page-search.service');

      const PageSearchService = this.moduleRef.get(
        TypesenseModule.PageSearchService,
        {
          strict: false,
        },
      );

      return PageSearchService.searchPage(searchParams, {
        userId: userId,
        workspaceId,
      });
    } catch (err) {
      this.logger.debug(
        'Typesense module requested but enterprise module not bundled in this build',
      );
    }

    throw new BadRequestException('Enterprise Typesense search module missing');
  }
}
