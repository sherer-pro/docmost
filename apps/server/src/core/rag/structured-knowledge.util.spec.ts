import {
  knowledgeSections,
  resolveCurrentEvidence,
  structuredParts,
  editorKnowledgeHeadings,
} from './structured-knowledge.util';
import { fitEvidence } from './rag-evidence.util';

describe('Canonical structured evidence', () => {
  it('maps every tab title to its stable source anchor including inactive content', () => {
    const headings = editorKnowledgeHeadings({
      type: 'doc',
      content: [
        {
          type: 'tabs',
          content: [
            {
              type: 'tabItem',
              attrs: { id: 'tab-one', title: 'Overview' },
              content: [],
            },
            {
              type: 'tabItem',
              attrs: { id: 'tab-two', title: 'Details' },
              content: [],
            },
          ],
        },
      ],
    });
    expect(headings.map((heading) => heading.id)).toEqual([
      'tab-one',
      'tab-two',
    ]);
    const sections = knowledgeSections(
      '### Overview\n\nVisible\n\n### Details\n\nHidden evidence',
      headings,
    );
    expect(
      sections.find((section) => section.id === 'tab-two')?.markdown,
    ).toContain('Hidden evidence');
  });
  it('keeps heading anchors when a heading contains a footnote', () => {
    const headings = editorKnowledgeHeadings({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { id: 'heading-note', level: 2 },
          content: [
            { type: 'text', text: 'Evidence' },
            {
              type: 'footnote',
              content: [{ type: 'text', text: 'Explanation' }],
            },
          ],
        },
      ],
    });
    expect(headings[0].title).toBe('Evidence');
    const sections = knowledgeSections(
      '# Document\n\n## Evidence[^1]\n\nBody\n\n[^1]: Explanation',
      headings,
    );
    expect(sections[1].id).toBe('heading-note');
  });
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
  it('retains every section of a small canonical local document within the existing parent budget', () => {
    const current =
      '# Guide\n\n## Logs\n\nLogs stay 30 days.\n\n## Backups\n\nBackups stay 90 days.';
    const result = resolveCurrentEvidence(current, {
      text: 'Compare retention periods in Guide',
      local: true,
    });
    expect(result?.excerpt).toBe(current);
    expect(result?.sectionId).toBeUndefined();
    expect(
      resolveCurrentEvidence(current, {
        text: 'Old value 100',
        sectionId: 'missing',
        local: true,
      }),
    ).toBeNull();
    expect(
      resolveCurrentEvidence(current, { text: 'Old value 100' }),
    ).toBeNull();
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
