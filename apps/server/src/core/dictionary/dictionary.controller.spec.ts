import { ForbiddenException } from '@nestjs/common';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { UserRole } from '../../common/helpers/types/permission';

describe('DictionaryController import/export actions', () => {
  const dictionaryService = {
    exportTerms: jest.fn(),
    importTerms: jest.fn(),
  };
  const spaceAbility = {
    createForUser: jest.fn(),
  };
  const controller = new DictionaryController(
    dictionaryService as unknown as DictionaryService,
    spaceAbility as any,
  );
  const workspace = { id: 'workspace-1' } as any;
  const admin = { id: 'admin-1', role: UserRole.ADMIN } as any;
  const owner = { id: 'owner-1', role: UserRole.OWNER } as any;
  const member = { id: 'member-1', role: UserRole.MEMBER } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports dictionary JSON for workspace admins', async () => {
    const response = {
      headers: jest.fn(),
      send: jest.fn(),
    };
    dictionaryService.exportTerms.mockResolvedValue({
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      terms: [
        {
          term: 'Alpha',
          forms: ['Alphas'],
          definitionMarkdown: 'Definition',
        },
      ],
    });

    await controller.exportTerms(
      { spaceId: '9d55e07a-2cc8-4b03-9297-189bfa5c3b74' },
      admin,
      workspace,
      response as any,
    );

    expect(dictionaryService.exportTerms).toHaveBeenCalledWith(
      '9d55e07a-2cc8-4b03-9297-189bfa5c3b74',
      'workspace-1',
    );
    expect(response.headers).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/json; charset=utf-8',
      }),
    );
    expect(JSON.parse(response.send.mock.calls[0][0])).toEqual({
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      terms: [
        {
          term: 'Alpha',
          forms: ['Alphas'],
          definitionMarkdown: 'Definition',
        },
      ],
    });
  });

  it('imports dictionary JSON for workspace owners', async () => {
    dictionaryService.importTerms.mockResolvedValue({
      created: 1,
      updated: 0,
      total: 1,
    });

    await expect(
      controller.importTermsAction(
        {
          spaceId: '9d55e07a-2cc8-4b03-9297-189bfa5c3b74',
          terms: [
            {
              term: 'Alpha',
              forms: [],
              definitionMarkdown: 'Definition',
            },
          ],
        },
        owner,
        workspace,
      ),
    ).resolves.toEqual({ created: 1, updated: 0, total: 1 });

    expect(dictionaryService.importTerms).toHaveBeenCalledWith(
      '9d55e07a-2cc8-4b03-9297-189bfa5c3b74',
      [
        {
          term: 'Alpha',
          forms: [],
          definitionMarkdown: 'Definition',
        },
      ],
      owner,
      'workspace-1',
    );
  });

  it('rejects dictionary export for workspace members', async () => {
    await expect(
      controller.exportTerms(
        { spaceId: '9d55e07a-2cc8-4b03-9297-189bfa5c3b74' },
        member,
        workspace,
        { headers: jest.fn(), send: jest.fn() } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(dictionaryService.exportTerms).not.toHaveBeenCalled();
  });

  it('rejects dictionary import for workspace members', async () => {
    await expect(
      controller.importTermsAction(
        {
          spaceId: '9d55e07a-2cc8-4b03-9297-189bfa5c3b74',
          terms: [],
        },
        member,
        workspace,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(dictionaryService.importTerms).not.toHaveBeenCalled();
  });
});
