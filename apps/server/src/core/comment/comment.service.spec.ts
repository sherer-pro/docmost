import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { CommentService } from './comment.service';
import { CommentRepo } from '@docmost/db/repos/comment/comment.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { QueueName } from '../../integrations/queue/constants';

describe('CommentService', () => {
  let service: CommentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentService,
        { provide: CommentRepo, useValue: {} },
        { provide: PageRepo, useValue: {} },
        { provide: getQueueToken(QueueName.GENERAL_QUEUE), useValue: {} },
        { provide: getQueueToken(QueueName.NOTIFICATION_QUEUE), useValue: {} },
      ],
    }).compile();

    service = module.get<CommentService>(CommentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
