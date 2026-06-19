import { BadRequestException } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';
import { DictionaryTermRepo } from '@docmost/db/repos/dictionary/dictionary-term.repo';

describe('DictionaryService', () => {
  const dictionaryTermRepo = {
    listBySpace: jest.fn(),
    findById: jest.fn(),
    findAliasesByNormalized: jest.fn(),
    insertTerm: jest.fn(),
    updateTerm: jest.fn(),
    softDeleteTerm: jest.fn(),
    deleteAliasesByTermId: jest.fn(),
    insertAliases: jest.fn(),
  };

  const trx = {};
  let selectQuery: any;
  const db = {
    transaction: jest.fn(() => ({
      execute: jest.fn(async (cb) => cb(trx)),
    })),
    selectFrom: jest.fn(),
  };

  const service = new DictionaryService(
    dictionaryTermRepo as unknown as DictionaryTermRepo,
    db as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    selectQuery = {
      select: jest.fn(() => selectQuery),
      where: jest.fn(() => selectQuery),
      executeTakeFirst: jest.fn().mockResolvedValue({ id: 'space-1' }),
    };
    db.selectFrom.mockReturnValue(selectQuery);
  });

  it('creates a term with normalized primary and form aliases', async () => {
    dictionaryTermRepo.findAliasesByNormalized.mockResolvedValue([]);
    dictionaryTermRepo.insertTerm.mockResolvedValue({
      id: 'term-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      term: 'Alpha',
      definitionMarkdown: 'Definition',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    dictionaryTermRepo.insertAliases.mockImplementation(async (aliases) =>
      aliases.map((alias, index) => ({ id: `alias-${index}`, ...alias })),
    );

    const result = await service.createTerm(
      {
        spaceId: 'space-1',
        term: '  Alpha  ',
        forms: ['Alpha', ' Alpha   Beta '],
        definitionMarkdown: 'Definition',
      },
      { id: 'user-1' } as any,
      'workspace-1',
    );

    expect(dictionaryTermRepo.findAliasesByNormalized).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
      ['alpha', 'alpha beta'],
      undefined,
    );
    expect(dictionaryTermRepo.insertAliases).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          alias: 'Alpha',
          normalizedAlias: 'alpha',
          isPrimary: true,
        }),
        expect.objectContaining({
          alias: 'Alpha Beta',
          normalizedAlias: 'alpha beta',
          isPrimary: false,
        }),
      ],
      trx,
    );
    expect(result.forms).toEqual(['Alpha Beta']);
  });

  it('rejects duplicate aliases in the same space', async () => {
    dictionaryTermRepo.findAliasesByNormalized.mockResolvedValue([
      { id: 'alias-1' },
    ]);

    await expect(
      service.createTerm(
        {
          spaceId: 'space-1',
          term: 'Alpha',
          forms: [],
          definitionMarkdown: 'Definition',
        },
        { id: 'user-1' } as any,
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rebuilds aliases during update while preserving omitted definition', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');

    dictionaryTermRepo.findById.mockResolvedValue({
      id: 'term-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      term: 'Alpha',
      definitionMarkdown: 'Existing definition',
      createdAt,
      updatedAt,
      aliases: [
        { alias: 'Alpha', isPrimary: true },
        { alias: 'Alphas', isPrimary: false },
      ],
    });
    dictionaryTermRepo.findAliasesByNormalized.mockResolvedValue([]);
    dictionaryTermRepo.updateTerm.mockResolvedValue({
      id: 'term-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      term: 'Beta',
      definitionMarkdown: 'Existing definition',
      createdAt,
      updatedAt,
    });
    dictionaryTermRepo.insertAliases.mockImplementation(async (aliases) =>
      aliases.map((alias, index) => ({ id: `alias-${index}`, ...alias })),
    );

    const result = await service.updateTerm(
      'term-1',
      { term: 'Beta', forms: ['Betas'] },
      'workspace-1',
    );

    expect(dictionaryTermRepo.deleteAliasesByTermId).toHaveBeenCalledWith(
      'term-1',
      'workspace-1',
      trx,
    );
    expect(dictionaryTermRepo.updateTerm).toHaveBeenCalledWith(
      'term-1',
      'workspace-1',
      expect.objectContaining({
        term: 'Beta',
        definitionMarkdown: 'Existing definition',
      }),
      trx,
    );
    expect(result.forms).toEqual(['Betas']);
  });

  it('exports only portable dictionary fields', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');

    dictionaryTermRepo.listBySpace.mockResolvedValue([
      {
        id: 'term-1',
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
        term: 'Alpha',
        definitionMarkdown: 'Definition',
        createdAt,
        updatedAt,
        aliases: [
          { alias: 'Alpha', isPrimary: true },
          { alias: 'Alphas', isPrimary: false },
        ],
      },
    ]);

    const result = await service.exportTerms('space-1', 'workspace-1');

    expect(db.selectFrom).toHaveBeenCalledWith('spaces');
    expect(result).toEqual({
      version: 1,
      exportedAt: expect.any(String),
      terms: [
        {
          term: 'Alpha',
          forms: ['Alphas'],
          definitionMarkdown: 'Definition',
        },
      ],
    });
  });

  it('imports new terms and updates existing primary term matches', async () => {
    dictionaryTermRepo.findAliasesByNormalized.mockResolvedValue([
      {
        id: 'alias-1',
        termId: 'term-1',
        normalizedAlias: 'alpha',
        isPrimary: true,
      },
    ]);
    dictionaryTermRepo.updateTerm.mockResolvedValue({
      id: 'term-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      term: 'Alpha',
      definitionMarkdown: 'Updated definition',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    dictionaryTermRepo.insertTerm.mockResolvedValue({
      id: 'term-2',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      term: 'Beta',
      definitionMarkdown: 'Beta definition',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    dictionaryTermRepo.insertAliases.mockImplementation(async (aliases) =>
      aliases.map((alias, index) => ({ id: `alias-${index}`, ...alias })),
    );

    const result = await service.importTerms(
      'space-1',
      [
        {
          term: ' Alpha ',
          forms: ['Alphas'],
          definitionMarkdown: ' Updated definition ',
        },
        {
          term: 'Beta',
          forms: [],
          definitionMarkdown: 'Beta definition',
        },
      ],
      { id: 'user-1' } as any,
      'workspace-1',
    );

    expect(result).toEqual({ created: 1, updated: 1, total: 2 });
    expect(dictionaryTermRepo.updateTerm).toHaveBeenCalledWith(
      'term-1',
      'workspace-1',
      {
        term: 'Alpha',
        definitionMarkdown: 'Updated definition',
      },
      trx,
    );
    expect(dictionaryTermRepo.deleteAliasesByTermId).toHaveBeenCalledWith(
      'term-1',
      'workspace-1',
      trx,
    );
    expect(dictionaryTermRepo.insertTerm).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorId: 'user-1',
        term: 'Beta',
        definitionMarkdown: 'Beta definition',
      }),
      trx,
    );
  });

  it('re-imports existing primary term matches without creating duplicates', async () => {
    dictionaryTermRepo.findAliasesByNormalized.mockResolvedValue([
      {
        id: 'alias-1',
        termId: 'term-1',
        normalizedAlias: 'alpha',
        isPrimary: true,
      },
      {
        id: 'alias-2',
        termId: 'term-2',
        normalizedAlias: 'beta',
        isPrimary: true,
      },
    ]);
    dictionaryTermRepo.updateTerm.mockImplementation(async (termId: string) => ({
      id: termId,
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      term: termId === 'term-1' ? 'Alpha' : 'Beta',
      definitionMarkdown: 'Definition',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    }));
    dictionaryTermRepo.insertAliases.mockImplementation(async (aliases) =>
      aliases.map((alias, index) => ({ id: `alias-${index}`, ...alias })),
    );

    const result = await service.importTerms(
      'space-1',
      [
        {
          term: 'Alpha',
          forms: [],
          definitionMarkdown: 'Definition',
        },
        {
          term: 'Beta',
          forms: [],
          definitionMarkdown: 'Definition',
        },
      ],
      { id: 'user-1' } as any,
      'workspace-1',
    );

    expect(result).toEqual({ created: 0, updated: 2, total: 2 });
    expect(dictionaryTermRepo.insertTerm).not.toHaveBeenCalled();
  });

  it('rejects duplicate aliases in the import file', async () => {
    await expect(
      service.importTerms(
        'space-1',
        [
          {
            term: 'Alpha',
            forms: [],
            definitionMarkdown: 'Definition',
          },
          {
            term: ' alpha ',
            forms: [],
            definitionMarkdown: 'Other definition',
          },
        ],
        { id: 'user-1' } as any,
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects imported aliases that belong to another existing term', async () => {
    dictionaryTermRepo.findAliasesByNormalized.mockResolvedValue([
      {
        id: 'alias-1',
        termId: 'term-1',
        normalizedAlias: 'alpha',
        isPrimary: true,
      },
      {
        id: 'alias-2',
        termId: 'term-2',
        normalizedAlias: 'alphas',
        isPrimary: false,
      },
    ]);

    await expect(
      service.importTerms(
        'space-1',
        [
          {
            term: 'Alpha',
            forms: ['Alphas'],
            definitionMarkdown: 'Definition',
          },
        ],
        { id: 'user-1' } as any,
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.transaction).not.toHaveBeenCalled();
  });
});
