import { AttachmentProcessor } from './attachment.processor';
import { QueueJob } from '../../../integrations/queue/constants';

describe('AttachmentProcessor', () => {
  it.each([
    [
      QueueJob.DELETE_SPACE_ATTACHMENTS,
      { id: 'space-id' },
      'handleDeleteSpaceAttachments',
      'space-id',
    ],
    [
      QueueJob.DELETE_USER_AVATARS,
      { id: 'user-id' },
      'handleDeleteUserAvatars',
      'user-id',
    ],
    [
      QueueJob.DELETE_PAGE_ATTACHMENTS,
      { pageId: 'page-id' },
      'handleDeletePageAttachments',
      'page-id',
    ],
  ] as const)(
    'preserves the legacy %s payload contract',
    async (name, data, handler, id) => {
      const attachmentService = {
        [handler]: jest.fn().mockResolvedValue(undefined),
      };
      const processor = new AttachmentProcessor(
        attachmentService as any,
        {} as any,
      );

      await processor.process({ name, data } as any);

      expect(attachmentService[handler]).toHaveBeenCalledWith(id);
    },
  );

  it.each([
    [QueueJob.DELETE_SPACE_ATTACHMENTS, {}],
    [QueueJob.DELETE_USER_AVATARS, { id: '' }],
    [QueueJob.DELETE_PAGE_ATTACHMENTS, { id: 'wrong-field' }],
  ])('fails closed for an incomplete %s payload', async (name, data) => {
    const processor = new AttachmentProcessor({} as any, {} as any);

    await expect(processor.process({ name, data } as any)).rejects.toThrow(
      'invalid_attachment_cleanup_job_payload',
    );
  });

  it('fails closed for an unknown queue job', async () => {
    const processor = new AttachmentProcessor({} as any, {} as any);

    await expect(
      processor.process({ name: 'retired-attachment-job', data: {} } as any),
    ).rejects.toThrow('unknown_attachment_queue_job');
  });
});
