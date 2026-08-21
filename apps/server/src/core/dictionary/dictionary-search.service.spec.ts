import {
  buildDictionaryDefinitionSnippet,
  buildDictionarySearchSnippet,
  rankDictionaryCandidate,
} from './dictionary-search.service';

describe('Dictionary search ranking', () => {
  it('normalizes case and diacritics for an exact term', () => {
    expect(
      rankDictionaryCandidate({ query: 'CAFE', term: 'Café' }),
    ).toMatchObject({ score: 1000, matchedField: 'term' });
  });

  it('ranks an exact form below an exact term and above prefixes', () => {
    const exactTerm = rankDictionaryCandidate({
      query: 'policy',
      term: 'Policy',
    });
    const exactForm = rankDictionaryCandidate({
      query: 'policies',
      term: 'Policy',
      forms: ['Policies'],
    });
    const prefix = rankDictionaryCandidate({ query: 'poli', term: 'Policy' });

    expect(exactForm).toMatchObject({
      matchedField: 'form',
      matchedForm: 'Policies',
    });
    expect(exactTerm!.score).toBeGreaterThan(exactForm!.score);
    expect(exactForm!.score).toBeGreaterThan(prefix!.score);
  });

  it('supports Cyrillic prefixes and typographical errors', () => {
    const prefix = rankDictionaryCandidate({
      query: 'словар',
      term: 'Словарь',
    });
    const typo = rankDictionaryCandidate({
      query: 'слвоарь',
      term: 'Словарь',
    });

    expect(prefix).toMatchObject({ matchedField: 'term' });
    expect(typo).toMatchObject({ matchedField: 'term' });
    expect(prefix!.score).toBeGreaterThan(typo!.score);
  });

  it('keeps definition-only matches below fuzzy aliases', () => {
    const typo = rankDictionaryCandidate({ query: 'polciy', term: 'Policy' });
    const definition = rankDictionaryCandidate({
      query: 'policy',
      term: 'Governance',
      definition: 'A documented policy for the team.',
    });

    expect(definition).toMatchObject({
      score: 100,
      matchedField: 'definition',
    });
    expect(typo!.score).toBeGreaterThan(definition!.score);
  });

  it('returns Unicode-safe match positions for snippets', () => {
    expect(buildDictionarySearchSnippet('Определение Café', 'cafe')).toEqual({
      text: 'Определение Café',
      matches: [{ start: 12, end: 16, value: 'Café' }],
    });
  });

  it('returns a plain-text definition preview with match positions', () => {
    expect(
      buildDictionaryDefinitionSnippet('**Protocol** definition', 'protocol'),
    ).toEqual({
      text: 'Protocol definition',
      matches: [{ start: 0, end: 8, value: 'Protocol' }],
    });
  });
});
