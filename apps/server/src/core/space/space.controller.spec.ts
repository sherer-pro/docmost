import { Test, TestingModule } from '@nestjs/testing';
import { SpaceController } from './space.controller';
import { SpaceService } from './services/space.service';
import { SpaceMemberService } from './services/space-member.service';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('SpaceController', () => {
  let controller: SpaceController;

  beforeEach(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [SpaceController],
      providers: [
        { provide: SpaceService, useValue: {} },
        { provide: SpaceMemberService, useValue: {} },
        { provide: SpaceMemberRepo, useValue: {} },
        { provide: SpaceAbilityFactory, useValue: {} },
        { provide: WorkspaceAbilityFactory, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) });

    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<SpaceController>(SpaceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
