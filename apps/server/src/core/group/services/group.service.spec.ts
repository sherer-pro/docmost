import { Test, TestingModule } from '@nestjs/testing';
import { GroupService } from './group.service';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { GroupUserService } from './group-user.service';
import { WatcherRepo } from '@docmost/db/repos/watcher/watcher.repo';

describe('GroupService', () => {
  let service: GroupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupService,
        { provide: GroupRepo, useValue: {} },
        { provide: GroupUserRepo, useValue: {} },
        { provide: SpaceMemberRepo, useValue: {} },
        { provide: GroupUserService, useValue: {} },
        { provide: WatcherRepo, useValue: {} },
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
      ],
    }).compile();

    service = module.get<GroupService>(GroupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
