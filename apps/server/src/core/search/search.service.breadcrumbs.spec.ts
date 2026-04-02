import { SearchService } from './search.service';
import { SearchResponseDto } from './dto/search-response.dto';

describe('SearchService breadcrumbs', () => {
  const service = new SearchService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const buildBreadcrumbsForResult = (service as any).buildBreadcrumbsForResult.bind(
    service,
  ) as (
    result: SearchResponseDto,
    ancestorsById: Map<string, any>,
    visiblePageIdsBySpaceId?: Map<string, Set<string>>,
  ) => Array<{ id: string; title: string }>;

  it('builds breadcrumbs from root to direct parent', () => {
    const result = {
      id: 'page-1',
      parentPageId: 'parent-2',
      space: { id: 'space-1' },
    } as SearchResponseDto;

    const ancestorsById = new Map<string, any>([
      [
        'parent-2',
        {
          id: 'parent-2',
          title: 'Parent 2',
          parentPageId: 'parent-1',
        },
      ],
      [
        'parent-1',
        {
          id: 'parent-1',
          title: 'Parent 1',
          parentPageId: null,
        },
      ],
    ]);

    expect(buildBreadcrumbsForResult(result, ancestorsById)).toEqual([
      { id: 'parent-1', title: 'Parent 1' },
      { id: 'parent-2', title: 'Parent 2' },
    ]);
  });

  it('filters hidden ancestors when visibility snapshot is provided', () => {
    const result = {
      id: 'page-1',
      parentPageId: 'parent-2',
      space: { id: 'space-1' },
    } as SearchResponseDto;

    const ancestorsById = new Map<string, any>([
      [
        'parent-2',
        {
          id: 'parent-2',
          title: 'Parent 2',
          parentPageId: 'parent-1',
        },
      ],
      [
        'parent-1',
        {
          id: 'parent-1',
          title: 'Parent 1',
          parentPageId: null,
        },
      ],
    ]);

    const visiblePageIdsBySpaceId = new Map<string, Set<string>>([
      ['space-1', new Set(['parent-2'])],
    ]);

    expect(
      buildBreadcrumbsForResult(
        result,
        ancestorsById,
        visiblePageIdsBySpaceId,
      ),
    ).toEqual([{ id: 'parent-2', title: 'Parent 2' }]);
  });

  it('returns empty breadcrumbs for root pages', () => {
    const result = {
      id: 'page-1',
      parentPageId: null,
      space: { id: 'space-1' },
    } as unknown as SearchResponseDto;

    expect(buildBreadcrumbsForResult(result, new Map())).toEqual([]);
  });
});
