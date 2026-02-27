import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PageService } from './page.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import { QueueName } from '../../../integrations/queue/constants';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import { WatcherService } from '../../watcher/watcher.service';
import { RecipientResolverService } from '../../notification/services/recipient-resolver.service';

// TODO(DOC-2471): remove quarantine after Jest ESM interoperability for collaboration dependencies is stabilized.
describe.skip('PageService [quarantine: DOC-2471]', () => {
  let service: PageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PageService,
        { provide: PageRepo, useValue: {} },
        { provide: AttachmentRepo, useValue: {} },
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: getQueueToken(QueueName.ATTACHMENT_QUEUE), useValue: {} },
        { provide: getQueueToken(QueueName.AI_QUEUE), useValue: {} },
        { provide: getQueueToken(QueueName.GENERAL_QUEUE), useValue: {} },
        { provide: getQueueToken(QueueName.NOTIFICATION_QUEUE), useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: CollaborationGateway, useValue: {} },
        { provide: WatcherService, useValue: {} },
        { provide: RecipientResolverService, useValue: {} },
      ],
    }).compile();

    service = module.get<PageService>(PageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
