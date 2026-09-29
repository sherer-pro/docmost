import {
  knowledgeSections,
  resolveCurrentEvidence,
  structuredParts,
} from './structured-knowledge.util';
import { fitEvidence } from './rag-evidence.util';

describe('Canonical structured evidence', () => {
  it('keeps editor section IDs across title and value changes', () => {
    const headings = [{ id: 'stable-id', title: 'Updated heading', level: 2 }];
    const markdown = '# Document\n\n## Updated heading\n\nValue is 200.';
    expect(knowledgeSections(markdown, headings)[1].id).toBe('stable-id');
    expect(
      resolveCurrentEvidence(
        markdown,
        { text: 'Value is 100.', sectionId: 'stable-id' },
        headings,
      )?.excerpt,
    ).toContain('200');
  });
  it('rejects an obsolete v2 value and resolves v3 to the current section', () => {
    const current = '## Limit\n\nThe limit is 200 units.';
    expect(
      resolveCurrentEvidence(current, { text: 'The limit is 100 units.' }),
    ).toBeNull();
    const sectionId = knowledgeSections(current)[0].id;
    expect(
      resolveCurrentEvidence(current, {
        text: 'The limit is 100 units.',
        sectionId,
      })?.excerpt,
    ).toContain('200');
    expect(
      resolveCurrentEvidence(current, {
        text: 'The limit is 100 units.',
        sectionId,
      })?.excerpt,
    ).not.toContain('100');
  });

  it('preserves headers, units and conditions for every table row', () => {
    const markdown =
      '## Tariffs\n\nOnly for annual contracts.\n\n| Plan | Price, RUB/month |\n| --- | --- |\n| Basic | 200 |\n| Pro | 500 |\n\nTaxes are excluded.';
    const parts = structuredParts(markdown);
    for (const part of parts.filter(
      (item) =>
        item.markdown.includes('| Basic |') ||
        item.markdown.includes('| Pro |'),
    )) {
      expect(part.markdown).toContain('Price, RUB/month');
      expect(part.markdown).toContain('Only for annual contracts.');
      expect(part.markdown).toContain('Taxes are excluded.');
    }
    expect(parts.map((part) => part.markdown).join('\n')).toContain('500');
  });

  it('preserves fenced headings and excludes ambiguous excerpt matches', () => {
    const markdown =
      '## First\n\nShared fact.\n\n```md\n## Not a section\n```\n\n## Second\n\nShared fact.';
    expect(knowledgeSections(markdown)).toHaveLength(2);
    expect(
      resolveCurrentEvidence(markdown, { text: 'Shared fact.' }),
    ).toBeNull();
  });

  it('does not leave a bare citation header or split a table', () => {
    expect(fitEvidence('[S1] Page\n\n' + 'long '.repeat(500), 50)).toBe('');
    expect(
      fitEvidence('| Value |\n| --- |\n| ' + 'a'.repeat(500) + ' |', 50),
    ).toBe('');
  });
});
