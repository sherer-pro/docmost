import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';

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
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
