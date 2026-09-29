import {
  evidenceBlocks,
  evidenceHash,
  evidenceTokenUpperBound,
  fitEvidence,
  normalizeEvidence,
} from './rag-evidence.util';

export interface KnowledgeSection {
  id: string;
  headingPath: string[];
  markdown: string;
}

export type KnowledgeHeading = { id: string; title: string; level: number };

export function editorKnowledgeHeadings(content: unknown): KnowledgeHeading[] {
  const result: KnowledgeHeading[] = [];
  const text = (node: any): string =>
    typeof node?.text === 'string'
      ? node.text
      : Array.isArray(node?.content)
        ? node.content.map(text).join('')
        : '';
  const visit = (node: any) => {
    if (!node || result.length >= 500) return;
    if (
      node.type === 'heading' &&
      typeof node.attrs?.id === 'string' &&
      /^[\w-]{1,100}$/.test(node.attrs.id)
    )
      result.push({
        id: node.attrs.id,
        title: text(node),
        level: Number(node.attrs.level),
      });
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(content);
  return result.filter(
    (item, index) =>
      result.findIndex((other) => other.id === item.id) === index,
  );
}

/** Only headings inside this source are used; no ancestor page titles leak. */
export function knowledgeSections(
  markdown: string,
  headings: KnowledgeHeading[] = [],
): KnowledgeSection[] {
  const sections: KnowledgeSection[] = [];
  const path: string[] = [];
  const occurrences = new Map<string, number>();
  let lines: string[] = [];
  let id = 'root';
  let fence: string | null = null;
  const unused = [...headings];
  const flush = () => {
    if (lines.some((line) => line.trim()))
      sections.push({
        id,
        headingPath: path.filter(Boolean),
        markdown: lines.join('\n').trim(),
      });
    lines = [];
  };
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (
        delimiter[1][0] === fence[0] &&
        delimiter[1].length >= fence.length
      )
        fence = null;
    }
    const heading =
      !fence && !delimiter && line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flush();
      path.length = heading[1].length - 1;
      path.push(heading[2]);
      const key = path.filter(Boolean).join(' / ');
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      id = `section-${evidenceHash(`${key}:${occurrence}`).slice(0, 20)}`;
      const headingIndex = unused.findIndex(
        (item) =>
          item.level === heading[1].length &&
          normalizeEvidence(item.title) === normalizeEvidence(heading[2]),
      );
      // The first heading of an export is the generated document title.
      if (headingIndex >= 0 && sections.length > 0)
        id = unused.splice(headingIndex, 1)[0].id;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

/** Table slices repeat headers and nearby conditions instead of orphaning values. */
function knowledgeBlocks(markdown: string): string[] {
  return evidenceBlocks(markdown).flatMap((block, blockIndex, blocks) => {
    const rows = block.split('\n');
    const separator = rows.findIndex((row) => /^\s*\|?\s*:?-{3,}/.test(row));
    if (separator < 1 || rows.length <= separator + 2) return [block];
    const header = rows.slice(0, separator + 1).join('\n');
    // Retain captions/conditions surrounding a table in each row projection.
    const before = blocks[blockIndex - 1] ?? '';
    const after = blocks[blockIndex + 1] ?? '';
    return rows
      .slice(separator + 1)
      .filter((row) => row.trim())
      .map((row) => [before, header, row, after].filter(Boolean).join('\n\n'));
  });
}

export function structuredParts(
  markdown: string,
  headings: KnowledgeHeading[] = [],
) {
  return knowledgeSections(markdown, headings).flatMap((section) => {
    const blocks = knowledgeBlocks(section.markdown);
    const children: string[] = [];
    let current = '';
    // Conservative byte-token estimates; atomic rules may exceed the soft target.
    for (const block of blocks) {
      if (current && evidenceTokenUpperBound(current + '\n\n' + block) > 350) {
        children.push(current);
        const previous = evidenceBlocks(current).at(-1) ?? '';
        current = evidenceTokenUpperBound(previous) <= 50 ? previous : '';
      }
      current = [current, block].filter(Boolean).join('\n\n');
    }
    if (current) children.push(current);
    return children.map((body, index) => ({
      partId: `${section.id}-${index}`,
      sectionId: section.id,
      headingPath: section.headingPath,
      markdown: [
        section.headingPath.length
          ? `Section: ${section.headingPath.join(' / ')}`
          : '',
        body,
      ]
        .filter(Boolean)
        .join('\n\n'),
    }));
  });
}

/** The remote index locates candidates; only current canonical bytes are returned. */
export function resolveCurrentEvidence(
  markdown: string,
  hit: { text: string; sectionId?: string; local?: boolean; partKey?: string },
  headings: KnowledgeHeading[] = [],
) {
  const sections = knowledgeSections(markdown, headings);
  const exact = normalizeEvidence(hit.text.replace(/^Section: [^\n]+\n\n/, ''));
  const matching = hit.sectionId
    ? sections.filter((section) => section.id === hit.sectionId)
    : hit.local
      ? sections
          .map((section) => ({
            section,
            rank: [
              ...new Set(exact.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []),
            ].filter((word) =>
              normalizeEvidence(section.markdown).toLowerCase().includes(word),
            ).length,
          }))
          .filter((item) => item.rank > 0)
          .sort((a, b) => b.rank - a.rank)
          .slice(0, 1)
          .map((item) => item.section)
      : sections.filter(
          (section) =>
            exact && normalizeEvidence(section.markdown).includes(exact),
        );
  if (matching.length !== 1) return null;
  const section = matching[0];
  const blocks = knowledgeBlocks(section.markdown);
  let excerpt = fitEvidence(section.markdown, 1200);
  if (hit.sectionId && !normalizeEvidence(excerpt).includes(exact)) {
    const childIndex = hit.partKey?.match(/-(\d+)-[a-f0-9]{16}$/)?.[1];
    const child =
      childIndex === undefined
        ? undefined
        : structuredParts(markdown, headings).filter(
            (part) => part.sectionId === section.id,
          )[Number(childIndex)];
    const block = blocks.find((value) =>
      normalizeEvidence(value).includes(exact),
    );
    excerpt = block ?? child?.markdown ?? excerpt;
    if (evidenceTokenUpperBound(excerpt) > 16_384) return null;
  }
  if (
    !excerpt ||
    (!hit.local &&
      !hit.sectionId &&
      !normalizeEvidence(excerpt).includes(exact))
  ) {
    const block = blocks.find((value) =>
      normalizeEvidence(value).includes(exact),
    );
    if (!block) return null;
    // Do not split an oversized table, exception or rule at an arbitrary byte.
    excerpt = block;
    if (evidenceTokenUpperBound(excerpt) > 16_384) return null;
  }
  return {
    excerpt,
    sectionId: section.id,
    headingPath: section.headingPath,
    refreshed: !normalizeEvidence(markdown).includes(exact),
  };
}
