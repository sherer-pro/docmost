import { Test, TestingModule } from '@nestjs/testing';
import { PageController } from './page.controller';
import { PageService } from './services/page.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageHistoryService } from './services/page-history.service';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import { CollaborationGateway } from '../../collaboration/collaboration.gateway';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

// TODO(DOC-2471): remove quarantine after Jest ESM interoperability for collaboration dependencies is stabilized.
describe.skip('PageController [quarantine: DOC-2471]', () => {
  let controller: PageController;

  beforeEach(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [PageController],
      providers: [
        { provide: PageService, useValue: {} },
        { provide: PageRepo, useValue: {} },
        { provide: PageHistoryService, useValue: {} },
        { provide: SpaceAbilityFactory, useValue: {} },
        { provide: CollaborationGateway, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) });

    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<PageController>(PageController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
