import { GeneralQueueProcessor } from './processors/general-queue.processor';
import { QueueModule } from './queue.module';

describe('QueueModule process roles', () => {
  it('registers the general worker for the API process', () => {
    expect(QueueModule.forRoot().providers).toContain(GeneralQueueProcessor);
  });

  it('registers queue clients without the general worker for collaboration', () => {
    expect(
      QueueModule.forRoot({ registerGeneralWorker: false }).providers,
    ).not.toContain(GeneralQueueProcessor);
  });
});
