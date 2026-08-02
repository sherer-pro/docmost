import { buildSearchTsQuery } from './search.service';

describe('buildSearchTsQuery', () => {
  it('drops punctuation that f_unaccent expands into tsquery structure', () => {
    const searchQuery = buildSearchTsQuery(
      'Задание «ремонтный аккаунт» (v2)',
    );

    expect(searchQuery).toBeDefined();
    expect(searchQuery).not.toMatch(/[«»<>]/);
    expect(searchQuery).toBe('Задание&ремонтный&аккаунт&v2');
  });

  it('keeps the operators pg-tsquery understands', () => {
    expect(buildSearchTsQuery('release | notes')).toBe('release|notes:*');
    expect(buildSearchTsQuery('test-case')).toBe('test-case:*');
  });

  it('returns undefined when nothing searchable remains', () => {
    expect(buildSearchTsQuery('«»')).toBeUndefined();
    expect(buildSearchTsQuery('   ')).toBeUndefined();
    expect(buildSearchTsQuery('***')).toBeUndefined();
  });
});
