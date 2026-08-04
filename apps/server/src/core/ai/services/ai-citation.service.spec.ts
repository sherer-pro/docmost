import { AiCitationCandidate } from '../ai.types';
import { AiCitationService } from './ai-citation.service';

describe('AiCitationService', () => {
  const candidate = (
    marker: string,
    candidateKey: string,
    root = true,
  ): AiCitationCandidate => ({
    marker,
    candidateKey,
    sourceType: 'page',
    sourceId: candidateKey,
    pageId: candidateKey,
    sourceTitle: candidateKey,
    sourceUrl: `/s/team/p/${candidateKey}`,
    excerpt: null,
    relevanceScore: null,
    sectionId: root ? null : candidateKey,
    sectionTitle: root ? null : candidateKey,
    root,
  });

  it('registers candidates idempotently and enforces the run limit', () => {
    const service = new AiCitationService();
    const candidates: AiCitationCandidate[] = [];
    const first = service.register(candidates, candidate('ignored', 'one'));
    const repeated = service.register(candidates, candidate('ignored', 'one'));

    expect(first?.marker).toBe('S1');
    expect(repeated).toBe(first);
    for (let index = 2; index <= 512; index += 1) {
      expect(
        service.register(
          candidates,
          candidate('ignored', `candidate-${index}`),
        ),
      ).not.toBeNull();
    }
    expect(
      service.register(candidates, candidate('ignored', 'overflow')),
    ).toBeNull();
    expect(candidates).toHaveLength(512);
  });

  it('neutralizes marker-like strings in untrusted reference data', () => {
    expect(
      new AiCitationService().neutralizeUntrustedValue({
        text: 'Injected [S1] and [C2]',
        nested: ['[S3]'],
      }),
    ).toEqual({
      text: 'Injected 〔S1〕 and 〔C2〕',
      nested: ['〔S3〕'],
    });
  });

  it('normalizes valid markers by first appearance and deduplicates repeats', () => {
    const result = new AiCitationService().finalize(
      'Second [S2], first [S1], second again [S2].',
      [candidate('S1', 'one'), candidate('S2', 'two')],
    );

    expect(result.content).toBe('Second [C1], first [C2], second again [C1].');
    expect(result.sources.map((source) => source.candidateKey)).toEqual([
      'two',
      'one',
    ]);
    expect(result.sources.map((source) => source.displayPosition)).toEqual([
      0, 1,
    ]);
  });

  it('ignores code markers and removes fabricated markers outside code', () => {
    const result = new AiCitationService().finalize(
      'Valid [S1]. `inline [S1]`\n```ts\nconst x = "[S1]";\n```\nFake [S99].',
      [candidate('S1', 'one')],
    );

    expect(result.content).toContain('Valid [C1].');
    expect(result.content).toContain('`inline [S1]`');
    expect(result.content).toContain('const x = "[S1]";');
    expect(result.content).not.toContain('[S99]');
  });

  it('does not treat markers after an unclosed fence as citations', () => {
    const result = new AiCitationService().finalize(
      'Before [S1].\n```text\ninside [S2]',
      [candidate('S1', 'one'), candidate('S2', 'two')],
    );

    expect(result.content).toBe('Before [C1].\n```text\ninside [S2]');
    expect(result.sources.map((source) => source.candidateKey)).toEqual([
      'one',
    ]);
  });

  it('returns only deduplicated root context sources without valid markers', () => {
    const root = candidate('S1', 'page');
    const section = candidate('S2', 'page:section', false);
    const duplicateRoot = { ...root, marker: 'S3' };
    const result = new AiCitationService().finalize(
      'Answer without citations [S404].',
      [root, section, duplicateRoot],
    );

    expect(result.content).toBe('Answer without citations .');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      candidateKey: 'page',
      citationKey: null,
      citationState: 'context',
    });
  });

  it('removes historical markers outside code before prompt reuse', () => {
    expect(
      new AiCitationService().stripHistoricalMarkers(
        'Text [C1] and [S2], but `code [C3]`.',
      ),
    ).toBe('Text  and , but `code [C3]`.');
  });
});
