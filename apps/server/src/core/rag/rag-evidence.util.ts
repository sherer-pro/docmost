import { createHash } from 'node:crypto';

export function evidenceHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function normalizeEvidence(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/** UTF-8 bytes bound text tokens for byte-fallback tokenizers. */
export function evidenceTokenUpperBound(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Keep complete paragraphs, table rows and fenced code blocks. */
export function evidenceBlocks(markdown: string): string[] {
  const result: string[] = [];
  let block: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length)
        fence = null;
    }
    if (!line.trim() && !fence) {
      if (block.length) result.push(block.join('\n'));
      block = [];
    } else block.push(line);
  }
  if (block.length) result.push(block.join('\n'));
  return result.filter((value) => value.trim());
}

export function fitEvidence(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (evidenceTokenUpperBound(text) <= maxBytes) return text;
  const suffix = '\n\n[Evidence truncated at a block boundary]';
  const selected: string[] = [];
  for (const block of evidenceBlocks(text)) {
    const next = [...selected, block].join('\n\n');
    if (evidenceTokenUpperBound(next + suffix) > maxBytes) break;
    selected.push(block);
  }
  while (
    selected.length &&
    /^(?:#{1,6}\s+[^\n]+|\[S\d+\][^\n]*)$/.test(selected.at(-1)!)
  )
    selected.pop();
  if (selected.length) {
    return selected.join('\n\n') + suffix;
  }
  // A single oversized paragraph is cut only at a complete sentence.
  if (text.includes('```') || text.includes('~~~') || /^\s*\|/m.test(text))
    return '';
  const firstLineEnd = text.indexOf('\n');
  const prefix = firstLineEnd >= 0 ? text.slice(0, firstLineEnd + 1) : '';
  const sentences =
    text.slice(prefix.length).match(/[^.!?\n]+[.!?](?:\s|$)/gu) ?? [];
  let result = '';
  for (const sentence of sentences) {
    if (evidenceTokenUpperBound(prefix + result + sentence + suffix) > maxBytes)
      break;
    result += sentence;
  }
  return result.trim() ? prefix + result.trim() + suffix : '';
}
