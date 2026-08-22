import { GeneralQueueProcessor } from './general-queue.processor';

describe('GeneralQueueProcessor', () => {
  it('fails unknown jobs instead of acknowledging them', async () => {
    const processor = Object.create(
      GeneralQueueProcessor.prototype,
    ) as GeneralQueueProcessor;

    await expect(
      processor.process({ name: 'retired-job', data: {} } as any),
    ).rejects.toThrow('Unsupported general queue job: retired-job');
  });
});
