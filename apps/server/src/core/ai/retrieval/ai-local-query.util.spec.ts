import {
  localRetrievalQueries,
  followUpQuotedName,
} from './ai-local-query.util';

describe('local retrieval query variants', () => {
  it('uses a single prior quoted topic only for a short follow-up without a new explicit name', () => {
    const previous = 'Расскажи о сервисе «Атлас».';
    expect(followUpQuotedName('А сколько стоят оба тарифа?', previous)).toBe(
      'Атлас',
    );
    expect(
      followUpQuotedName('А сколько стоит «Вектор»?', previous),
    ).toBeUndefined();
    expect(
      followUpQuotedName('А сколько стоит Вектор?', previous),
    ).toBeUndefined();
    expect(
      followUpQuotedName('Расскажи о другом сервисе', previous),
    ).toBeUndefined();
    expect(
      followUpQuotedName('А сколько стоят?', 'Сравни «Атлас» и «Вектор»'),
    ).toBeUndefined();
    expect(
      followUpQuotedName('And its price?', 'Discuss "Project Atlas"'),
    ).toBe('Project Atlas');
    expect(
      localRetrievalQueries('And its price?', [
        'Project Atlas price',
        'Project Atlas',
      ]),
    ).toEqual(['And its price?', 'Project Atlas price', 'Project Atlas']);
  });
  it('preserves the full request and adds a literal quoted name without search operators', () => {
    expect(
      localRetrievalQueries('What is the limit of "Project Atlas"?'),
    ).toEqual(['What is the limit of "Project Atlas"?', 'Project Atlas']);
    expect(localRetrievalQueries('Quota for «Atlas | !secret»')).toEqual([
      'Quota for «Atlas | !secret»',
      'Atlas    secret',
    ]);
  });
  it('includes a successful follow-up rewrite, deduplicates and bounds fan-out and length', () => {
    const query = 'And its price?';
    expect(
      localRetrievalQueries(query, ['Price for «Atlas»', 'Another expansion']),
    ).toEqual([query, 'Price for «Atlas»', 'Atlas']);
    expect(localRetrievalQueries('Atlas', ['Atlas'])).toEqual(['Atlas']);
    expect(localRetrievalQueries('x'.repeat(10000))[0]).toHaveLength(512);
  });
});
