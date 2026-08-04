import { Test } from '@nestjs/testing';
import { TransclusionController } from '../transclusion.controller';
import { TransclusionService } from '../transclusion.service';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { PageEmbedService } from '../page-embed.service';

describe('TransclusionController.lookup', () => {
  let controller: TransclusionController;
  let service: jest.Mocked<TransclusionService>;
  let pageEmbedService: { lookup: jest.Mock; getMaxDepth: jest.Mock };

  beforeEach(async () => {
    service = {
      lookup: jest.fn(),
      listReferences: jest.fn(),
      unsyncReference: jest.fn(),
    } as any;
    pageEmbedService = {
      lookup: jest.fn().mockResolvedValue({ items: [] }),
      getMaxDepth: jest.fn(() => 5),
    };

    const module = await Test.createTestingModule({
      controllers: [TransclusionController],
      providers: [
        { provide: TransclusionService, useValue: service },
        { provide: PageEmbedService, useValue: pageEmbedService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TransclusionController);
  });

  const user = { id: 'u1', workspaceId: 'w1' } as any;
  const ref = { sourcePageId: 'p1', transclusionId: 'e1' };

  it('passes the references and viewer through to the service and returns its result', async () => {
    service.lookup.mockResolvedValue({
      items: [
        {
          sourcePageId: 'p1',
          transclusionId: 'e1',
          content: { type: 'doc' },
          sourceUpdatedAt: new Date(),
        },
      ],
    } as any);

    const out = await controller.lookup({ references: [ref] } as any, user);
    expect(out.items[0]).not.toHaveProperty('status');
    expect((out.items[0] as any).content).toEqual({ type: 'doc' });
    expect(out.maxDepth).toBe(5);
    expect(service.lookup).toHaveBeenCalledWith([ref], user);
    expect(pageEmbedService.lookup).toHaveBeenCalledWith([], user, undefined);
  });
});
