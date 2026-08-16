import type {
  SearchTagMatchDto,
  SearchTagSnippetDto,
} from './dto/search-response.dto';

const TAG_VALUE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const ANCHOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_SNIPPETS = 3;
const MAX_SNIPPET_LENGTH = 240;
const LEADING_CONTEXT_LENGTH = 80;

interface ContentNode {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  content?: unknown;
}

interface TagBlock {
  node: ContentNode;
  anchorId?: string;
}

interface RenderedBlock {
  text: string;
  matches: SearchTagMatchDto[];
}

class PlainTextBuilder {
  private value = '';
  private pendingSpace = false;
  readonly matches: SearchTagMatchDto[] = [];

  appendText(value: string) {
    for (const character of value) {
      if (/\s/u.test(character)) {
        this.pendingSpace = this.value.length > 0;
        continue;
      }

      if (this.pendingSpace) {
        this.value += ' ';
        this.pendingSpace = false;
      }
      this.value += character;
    }
  }

  appendBoundary() {
    this.pendingSpace = this.value.length > 0;
  }

  appendTag(label: string, value: string, selected: boolean) {
    if (this.pendingSpace) {
      this.value += ' ';
      this.pendingSpace = false;
    }

    const start = this.value.length;
    this.value += label;
    if (selected) {
      this.matches.push({ start, end: this.value.length, value });
    }
  }

  build(): RenderedBlock {
    return { text: this.value, matches: this.matches };
  }
}

function asContentNode(value: unknown): ContentNode | undefined {
  return value !== null && typeof value === 'object'
    ? (value as ContentNode)
    : undefined;
}

function getChildren(node: ContentNode): ContentNode[] {
  if (!Array.isArray(node.content)) {
    return [];
  }

  return node.content
    .map(asContentNode)
    .filter((child): child is ContentNode => Boolean(child));
}

function getTagValue(node: ContentNode): string | undefined {
  if (node.type !== 'tag' || !node.attrs || typeof node.attrs !== 'object') {
    return undefined;
  }

  const rawValue = (node.attrs as Record<string, unknown>).value;
  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const value = rawValue.trim().toLowerCase();
  return TAG_VALUE_PATTERN.test(value) ? value : undefined;
}

function getAnchorId(node: ContentNode): string | undefined {
  if (!node.attrs || typeof node.attrs !== 'object') {
    return undefined;
  }

  const value = (node.attrs as Record<string, unknown>).id;
  return typeof value === 'string' && ANCHOR_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function renderBlock(
  node: ContentNode,
  selectedTags: ReadonlySet<string>,
): RenderedBlock {
  const builder = new PlainTextBuilder();

  const visit = (current: ContentNode, depth: number) => {
    if (typeof current.text === 'string') {
      builder.appendText(current.text);
    }

    const tagValue = getTagValue(current);
    if (tagValue) {
      builder.appendTag(
        tagValue.toUpperCase(),
        tagValue,
        selectedTags.has(tagValue),
      );
      return;
    }

    const children = getChildren(current);
    children.forEach((child, index) => {
      if (depth > 0 && index > 0 && child.type !== 'text') {
        builder.appendBoundary();
      }
      visit(child, depth + 1);
    });
  };

  visit(node, 0);
  return builder.build();
}

function cropSnippet(rendered: RenderedBlock): RenderedBlock {
  if (
    rendered.text.length <= MAX_SNIPPET_LENGTH ||
    rendered.matches.length === 0
  ) {
    return rendered;
  }

  const firstMatch = rendered.matches[0];
  let start = Math.max(0, firstMatch.start - LEADING_CONTEXT_LENGTH);
  let end = Math.min(rendered.text.length, start + MAX_SNIPPET_LENGTH);

  if (end === rendered.text.length) {
    start = Math.max(0, end - MAX_SNIPPET_LENGTH);
  }

  while (start > 0 && !/\s/u.test(rendered.text[start - 1])) {
    start -= 1;
  }
  while (end < rendered.text.length && !/\s/u.test(rendered.text[end])) {
    end += 1;
  }

  const prefix = start > 0 ? '... ' : '';
  const suffix = end < rendered.text.length ? ' ...' : '';
  const matches = rendered.matches
    .filter((match) => match.start >= start && match.end <= end)
    .map((match) => ({
      ...match,
      start: match.start - start + prefix.length,
      end: match.end - start + prefix.length,
    }));

  return {
    text: `${prefix}${rendered.text.slice(start, end).trim()}${suffix}`,
    matches,
  };
}

export function buildTagSearchMetadata(
  content: unknown,
  tags: readonly string[],
): { tagMatchCount: number; tagSnippets: SearchTagSnippetDto[] } {
  const selectedTags = new Set(
    tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
  );
  if (selectedTags.size === 0) {
    return { tagMatchCount: 0, tagSnippets: [] };
  }

  let normalizedContent = content;
  if (typeof normalizedContent === 'string') {
    try {
      normalizedContent = JSON.parse(normalizedContent);
    } catch {
      return { tagMatchCount: 0, tagSnippets: [] };
    }
  }

  const root = asContentNode(normalizedContent);
  if (!root) {
    return { tagMatchCount: 0, tagSnippets: [] };
  }

  let tagMatchCount = 0;
  const blocks = new Map<ContentNode, TagBlock>();

  const visit = (
    node: ContentNode,
    anchoredBlock: TagBlock | undefined,
    fallbackNode: ContentNode,
  ) => {
    const anchorId = getAnchorId(node);
    const currentBlock = anchorId ? { node, anchorId } : anchoredBlock;
    const tagValue = getTagValue(node);

    if (tagValue && selectedTags.has(tagValue)) {
      tagMatchCount += 1;
      const block = currentBlock ?? { node: fallbackNode };
      if (!blocks.has(block.node)) {
        blocks.set(block.node, block);
      }
    }

    getChildren(node).forEach((child) =>
      visit(child, currentBlock, fallbackNode),
    );
  };

  const rootChildren = getChildren(root);
  if (rootChildren.length === 0) {
    visit(root, undefined, root);
  } else {
    rootChildren.forEach((child) => visit(child, undefined, child));
  }

  const tagSnippets = [...blocks.values()]
    .slice(0, MAX_SNIPPETS)
    .map((block) => {
      const rendered = cropSnippet(renderBlock(block.node, selectedTags));
      return {
        anchorId: block.anchorId,
        text: rendered.text,
        matches: rendered.matches,
      };
    })
    .filter((snippet) => snippet.matches.length > 0);

  return { tagMatchCount, tagSnippets };
}
