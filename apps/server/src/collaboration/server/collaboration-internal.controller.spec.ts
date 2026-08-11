import { UnauthorizedException } from '@nestjs/common';

jest.mock('../collaboration.gateway', () => ({
  CollaborationGateway: class CollaborationGateway {},
}));

import { CollaborationInternalController } from './collaboration-internal.controller';

describe('CollaborationInternalController', () => {
  const secret = 's'.repeat(32);
  const collaboration = { handleYjsEvent: jest.fn() };
  const environment = { getCollabInternalSecret: () => secret };
  const request = {
    eventName: 'getAiPageContentHash' as const,
    documentName: 'page.11111111-1111-1111-1111-111111111111',
    payload: { user: { id: 'user-1' } },
  };

  beforeEach(() => {
    collaboration.handleYjsEvent.mockReset().mockResolvedValue('hash');
  });

  it('rejects commands without the internal credential', async () => {
    const controller = new CollaborationInternalController(
      collaboration as never,
      environment as never,
    );

    await expect(
      controller.handleCommand(undefined, request),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(collaboration.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('dispatches an authenticated, allowlisted page command', async () => {
    const controller = new CollaborationInternalController(
      collaboration as never,
      environment as never,
    );

    await expect(controller.handleCommand(secret, request)).resolves.toEqual({
      result: 'hash',
    });
    expect(collaboration.handleYjsEvent).toHaveBeenCalledWith(
      request.eventName,
      request.documentName,
      request.payload,
    );
  });
});
