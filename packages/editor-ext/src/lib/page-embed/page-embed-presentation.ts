export const PAGE_EMBED_CONTENT_ATTRIBUTE = 'data-docmost-page-embed-content';

export const PAGE_EMBED_PRESENTATION_STYLE = [
  'box-sizing: border-box',
  'border: 1px solid #d1d5db',
  'border-radius: 6px',
  'padding: 12px',
  'margin: 12px 0',
].join('; ');

export function getPageEmbedReferenceKey(sourcePageId?: string | null): string {
  return `page:${sourcePageId ?? ''}`;
}

export function getPageEmbedPresentationAttributes(): Record<string, string> {
  return {
    'data-docmost-page-embed': 'true',
    style: PAGE_EMBED_PRESENTATION_STYLE,
  };
}

export interface PageEmbedPresentationResolution {
  content?: unknown;
  status?: string;
}

export type PageEmbedPresentationMap =
  | Map<string, PageEmbedPresentationResolution>
  | Record<string, PageEmbedPresentationResolution>;

export function collectPageEmbedPresentationReferences(
  document: unknown,
): string[] {
  const sourceIds = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, any>;
    if (
      node.type === 'pageEmbed' &&
      typeof node.attrs?.sourcePageId === 'string'
    ) {
      sourceIds.add(node.attrs.sourcePageId);
    }
    if (Array.isArray(node.content)) node.content.forEach(collect);
  };
  collect(document);
  return Array.from(sourceIds);
}

export function materializePageEmbedsForPresentation<T>(
  document: T,
  resolutions: PageEmbedPresentationMap,
  unavailable: string,
  maxDepth = 5,
): T {
  const resolutionFor = (sourcePageId: string) =>
    resolutions instanceof Map
      ? resolutions.get(sourcePageId)
      : resolutions[sourcePageId];
  const visit = (value: unknown, depth: number, visited: Set<string>): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => visit(item, depth, visited));
    }
    if (!value || typeof value !== 'object') return value;
    const node = value as Record<string, any>;
    if (node.type === 'pageEmbed') {
      const sourcePageId = node.attrs?.sourcePageId;
      const resolution =
        typeof sourcePageId === 'string' ? resolutionFor(sourcePageId) : undefined;
      const content = resolution?.content as Record<string, any> | undefined;
      if (
        !sourcePageId ||
        depth >= maxDepth ||
        visited.has(sourcePageId) ||
        !resolution ||
        resolution.status ||
        !Array.isArray(content?.content)
      ) {
        return {
          type: 'paragraph',
          content: [{ type: 'text', text: unavailable }],
        };
      }
      const nextVisited = new Set(visited);
      nextVisited.add(sourcePageId);
      return content.content.map((item: unknown) =>
        visit(item, depth + 1, nextVisited),
      );
    }
    const copy = { ...node };
    if (Array.isArray(node.content)) {
      copy.content = node.content.flatMap((item: unknown) => {
        const resolved = visit(item, depth, visited);
        return Array.isArray(resolved) ? resolved : [resolved];
      });
    }
    return copy;
  };
  return visit(document, 0, new Set()) as T;
}
