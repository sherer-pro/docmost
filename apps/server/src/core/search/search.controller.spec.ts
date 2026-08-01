import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PageAccessService } from '../page-access/page-access.service';
import { AuthRateLimitGuard } from '../auth/rate-limit/auth-rate-limit.guard';
import { TypesenseSearchService } from './typesense-search.service';

describe('SearchController', () => {
  let controller: SearchController;
  let searchService: {
    searchPage: jest.Mock;
    searchAttachments: jest.Mock;
  };
  let typesenseSearchService: {
    searchPages: jest.Mock;
    searchAttachments: jest.Mock;
  };
  let environmentService: { getSearchDriver: jest.Mock };
  let pageAccessService: { hasAnyReadablePageInSpace: jest.Mock };

  beforeEach(async () => {
    searchService = {
      searchPage: jest.fn().mockResolvedValue({ items: [] }),
      searchAttachments: jest.fn().mockResolvedValue({ items: [] }),
    };
    typesenseSearchService = {
      searchPages: jest.fn().mockResolvedValue({ items: [] }),
      searchAttachments: jest.fn().mockResolvedValue({ items: [] }),
    };
    environmentService = {
      getSearchDriver: jest.fn().mockReturnValue('database'),
    };
    pageAccessService = {
      hasAnyReadablePageInSpace: jest.fn().mockResolvedValue(true),
    };

    const moduleBuilder = Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        { provide: SearchService, useValue: searchService },
        {
          provide: TypesenseSearchService,
          useValue: typesenseSearchService,
        },
        { provide: PageAccessService, useValue: pageAccessService },
        { provide: SpaceAbilityFactory, useValue: {} },
        { provide: EnvironmentService, useValue: environmentService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(AuthRateLimitGuard)
      .useValue({ canActivate: jest.fn(() => true) });

    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<SearchController>(SearchController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('routes ordinary page search through Typesense when enabled', async () => {
    environmentService.getSearchDriver.mockReturnValue('typesense');

    await controller.pageSearch(
      { query: 'policy' } as any,
      { id: 'user-1' } as any,
      { id: 'workspace-1' } as any,
    );

    expect(typesenseSearchService.searchPages).toHaveBeenCalledWith(
      { query: 'policy' },
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );
    expect(searchService.searchPage).not.toHaveBeenCalled();
  });

  it('keeps label-filtered page search on PostgreSQL', async () => {
    environmentService.getSearchDriver.mockReturnValue('typesense');

    await controller.pageSearch(
      { query: 'policy', labelId: 'label-1' } as any,
      { id: 'user-1' } as any,
      { id: 'workspace-1' } as any,
    );

    expect(searchService.searchPage).toHaveBeenCalled();
    expect(typesenseSearchService.searchPages).not.toHaveBeenCalled();
  });

  it('routes attachment content search through Typesense when enabled', async () => {
    environmentService.getSearchDriver.mockReturnValue('typesense');

    await controller.attachmentSearch(
      { query: 'contract' } as any,
      { id: 'user-1' } as any,
      { id: 'workspace-1' } as any,
    );

    expect(typesenseSearchService.searchAttachments).toHaveBeenCalledWith(
      { query: 'contract' },
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );
  });

  it('routes public share search through Typesense without a user identity', async () => {
    environmentService.getSearchDriver.mockReturnValue('typesense');

    await controller.searchShare(
      { query: 'roadmap', shareId: 'share-1' } as any,
      { id: 'workspace-1' } as any,
    );

    expect(typesenseSearchService.searchPages).toHaveBeenCalledWith(
      { query: 'roadmap', shareId: 'share-1' },
      { workspaceId: 'workspace-1' },
    );
  });
});
