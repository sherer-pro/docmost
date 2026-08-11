import { ServiceUnavailableException } from '@nestjs/common';
import { CollaborationHttpClientService } from './collaboration-http-client.service';

describe('CollaborationHttpClientService', () => {
  const environment = {
    getCollabInternalUrl: () => 'http://collab:3001',
    getCollabInternalSecret: () => 's'.repeat(32),
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends only the actor identifier to the collaboration runtime', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: { type: 'doc', content: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new CollaborationHttpClientService(environment as never);

    await service.getPageContent('page.11111111-1111-1111-1111-111111111111', {
      user: {
        id: 'user-1',
        name: 'must-not-cross-the-boundary',
      } as never,
    });

    const request = fetchMock.mock.calls[0][1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      payload: { user: { id: 'user-1' } },
    });
    expect(String(request?.body)).not.toContain('must-not-cross-the-boundary');
  });

  it('maps transport failures to a stable service-unavailable error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('connection reset'));
    const service = new CollaborationHttpClientService(environment as never);

    await expect(
      service.getPageContentHash('page.11111111-1111-1111-1111-111111111111', {
        user: { id: 'user-1' },
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
