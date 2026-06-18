import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageAccessService } from '../page-access/page-access.service';

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
        { provide: PageRepo, useValue: {} },
        { provide: ShareRepo, useValue: {} },
        { provide: SpaceMemberRepo, useValue: {} },
        { provide: UserRepo, useValue: {} },
        { provide: PageAccessService, useValue: {} },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('keeps readable page suggestions after access filtering', async () => {
    const sourcePage = {
      id: 'page-1',
      slugId: 'page-1',
      title: 'Test Page EN',
      icon: null,
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
    };
    let selectedColumns: string[] = [];
    const pageSearchQuery = {
      select: jest.fn((columns: string[]) => {
        selectedColumns = columns;
        return pageSearchQuery;
      }),
      where: jest.fn(() => pageSearchQuery),
      limit: jest.fn(() => pageSearchQuery),
      execute: jest.fn(async () => [
        Object.fromEntries(
          selectedColumns.map((column) => [column, sourcePage[column]]),
        ),
      ]),
    };
    const db = {
      selectFrom: jest.fn(() => pageSearchQuery),
    };
    const pageAccessService = {
      getEffectiveAccess: jest.fn(async (page, user) => ({
        capabilities: {
          canRead: page.workspaceId === user.workspaceId,
        },
      })),
    };

    const service = new SearchService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      pageAccessService as any,
    );

    const result = await service.searchSuggestions(
      {
        query: 'Tes',
        includePages: true,
        spaceId: 'space-1',
        limit: 10,
      },
      {
        id: 'user-1',
        workspaceId: 'workspace-1',
      } as any,
      'workspace-1',
    );

    expect(result.pages).toEqual([sourcePage]);
    expect(pageAccessService.getEffectiveAccess).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1' }),
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
  });
});
