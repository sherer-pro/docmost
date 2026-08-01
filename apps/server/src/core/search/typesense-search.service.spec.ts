import { TypesenseSearchService } from './typesense-search.service';

describe('TypesenseSearchService', () => {
  it('keeps creator filtering and shared breadcrumb enrichment consistent', async () => {
    const typesenseIndexService = {
      searchPages: jest.fn().mockResolvedValue({
        hits: [
          {
            document: { id: 'page-1' },
            text_match: 10,
            highlight: { content: { snippet: '<mark>result</mark>' } },
          },
        ],
      }),
    };
    const searchService = {
      attachBreadcrumbsToResults: jest
        .fn()
        .mockImplementation(async (items) =>
          items.map((item: any) => ({ ...item, breadcrumbs: [] })),
        ),
    };
    const service = new TypesenseSearchService(
      {} as any,
      typesenseIndexService as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ id: 'user-1' }) } as any,
      {} as any,
      searchService as any,
    );
    jest.spyOn(service as any, 'loadPages').mockResolvedValue([
      {
        id: 'page-1',
        title: 'Result',
        textContent: 'Current result content',
        spaceId: 'space-1',
      },
    ]);
    jest.spyOn(service as any, 'canReadPage').mockResolvedValue(true);

    const result = await service.searchPages(
      {
        query: 'result',
        creatorId: '11111111-1111-4111-8111-111111111111',
      } as any,
      {
        userId: 'user-1',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    );

    expect(typesenseIndexService.searchPages).toHaveBeenCalledWith(
      expect.objectContaining({
        filter_by: expect.stringContaining(
          'creatorId:=`11111111-1111-4111-8111-111111111111`',
        ),
      }),
    );
    expect(searchService.attachBreadcrumbsToResults).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({
      id: 'page-1',
      highlight: 'Current <mark>result</mark> content',
      breadcrumbs: [],
    });
    expect(result.items[0]).not.toHaveProperty('textContent');
  });

  it('omits space metadata from anonymous share results', async () => {
    const typesenseIndexService = {
      searchPages: jest.fn().mockResolvedValue({
        hits: [{ document: { id: 'page-1' }, text_match: 10 }],
      }),
    };
    const searchService = {
      attachBreadcrumbsToResults: jest
        .fn()
        .mockImplementation(async (items) => items),
    };
    const service = new TypesenseSearchService(
      {} as any,
      typesenseIndexService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      searchService as any,
    );
    jest.spyOn(service as any, 'resolvePublicShare').mockResolvedValue({
      pageIds: new Set(['page-1']),
      spaceId: 'space-1',
    });
    jest.spyOn(service as any, 'loadPages').mockResolvedValue([
      {
        id: 'page-1',
        title: 'Result',
        textContent: 'Current result content',
        spaceId: 'space-1',
        space: { id: 'space-1', name: 'Private space', slug: 'private' },
      },
    ]);

    const result = await service.searchPages(
      { query: 'result', shareId: 'share-1' } as any,
      { workspaceId: '22222222-2222-4222-8222-222222222222' },
    );

    expect(result.items[0].space).toBeUndefined();
  });

  it('never returns a stale Typesense content snippet', () => {
    const service = new TypesenseSearchService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    expect(
      (service as any).buildAuthoritativeHighlight('secret', [
        'Current public text',
      ]),
    ).toBe('');
  });

  it('escapes markup around the highlighted match', () => {
    const service = new TypesenseSearchService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    expect(
      (service as any).buildAuthoritativeHighlight('token', [
        '<img src=x onerror=alert(1)> token </script>',
      ]),
    ).toBe(
      '&lt;img src=x onerror=alert(1)&gt; <mark>token</mark> &lt;/script&gt;',
    );
  });
});
