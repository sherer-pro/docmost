export const Heading = {} as any;
export const Callout = {} as any;
export const Comment = {} as any;
export const CustomCodeBlock = {} as any;
export const Details = {} as any;
export const DetailsContent = {} as any;
export const DetailsSummary = {} as any;
export const LinkExtension = {} as any;
export const MathBlock = {} as any;
export const MathInline = {} as any;
export const TableHeader = {} as any;
export const TableCell = {} as any;
export const TableRow = {} as any;
export const CustomTable = {} as any;
export const TiptapImage = {} as any;
export const TiptapVideo = {} as any;
export const TrailingNode = { configure: () => ({}) } as any;
export const Attachment = {} as any;
export const Drawio = {} as any;
export const Excalidraw = {} as any;
export const Embed = {} as any;
export const Mention = {} as any;
export const Subpages = {} as any;
export const Highlight = {} as any;
export const UniqueID = { configure: () => ({}) } as any;
export const Indent = { configure: () => ({}) } as any;
export const PageBreak = {} as any;
export const Tag = {} as any;
export const builtInTagValues = ['tbd', 'todo', 'done'];
export const TiptapAudio = {} as any;
export const TiptapPdf = {} as any;
export const TableReadonlySort = {} as any;
export const TableView = {} as any;
export const TransclusionSource = {} as any;
export const TransclusionReference = {} as any;
export const TRANSCLUSION_LABEL_STYLE = 'font-weight: 600';

export function getTransclusionReferenceKey(
  sourcePageId?: string | null,
  transclusionId?: string | null,
) {
  return `${sourcePageId ?? ''}:${transclusionId ?? ''}`;
}

export function materializeTransclusionsForPresentation(
  document: any,
  resolutions: Map<string, any>,
  strings: { unavailable: string },
) {
  const visit = (node: any): any => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(visit);
    if (node.type === 'transclusionReference') {
      const resolution = resolutions.get(
        getTransclusionReferenceKey(
          node.attrs?.sourcePageId,
          node.attrs?.transclusionId,
        ),
      );
      return {
        type: 'transclusionSource',
        attrs: { id: node.attrs?.transclusionId ?? null },
        content: resolution?.content?.content ?? [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: strings.unavailable }],
          },
        ],
      };
    }
    return {
      ...node,
      ...(Array.isArray(node.content)
        ? { content: node.content.map(visit) }
        : {}),
    };
  };
  return visit(document);
}

export function addUniqueIdsToDoc(doc: any) {
  return doc;
}
export function addHeadingNumbersToJson(doc: any) {
  const cloned = JSON.parse(JSON.stringify(doc));
  let section = 0;
  let child = 0;

  for (const node of cloned.content ?? []) {
    if (node.type !== 'heading') continue;
    if (node.attrs?.level === 2) {
      section += 1;
      child = 0;
      node.content?.unshift({ type: 'text', text: `${section}. ` });
    } else if (node.attrs?.level === 3) {
      child += 1;
      node.content?.unshift({
        type: 'text',
        text: `${section || 1}.${child}. `,
      });
    }
  }

  return cloned;
}
export function htmlToMarkdown(input: string) {
  return input;
}
export function markdownToHtml(input: string) {
  return input;
}
export function sanitizeUrl(input: string | undefined) {
  if (!input) return '';
  const normalized = input.trim();
  return /^(https?:|mailto:|tel:|\/|#)/i.test(normalized) ? normalized : '';
}
export function getEmbedUrlAndProvider(url: string) {
  return { embedUrl: url, provider: 'iframe' };
}
