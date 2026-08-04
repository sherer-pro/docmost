export interface TransclusionPresentationStrings {
  label: string;
  unavailable: string;
}

export interface TransclusionPresentationResolution {
  content?: unknown;
  status?: string;
}

export type TransclusionPresentationMap =
  | Map<string, TransclusionPresentationResolution>
  | Record<string, TransclusionPresentationResolution>;

export const TRANSCLUSION_CONTENT_ATTRIBUTE =
  'data-docmost-transclusion-content';

export const TRANSCLUSION_PRESENTATION_STYLE = [
  'box-sizing: border-box',
  'border: 1px dashed #9ca3af',
  'border-radius: 6px',
  'padding: 12px',
  'margin: 12px 0',
].join('; ');

export const TRANSCLUSION_LABEL_STYLE = [
  'color: #6b7280',
  'font-size: 12px',
  'font-weight: 600',
  'margin-bottom: 8px',
].join('; ');

export function getTransclusionReferenceKey(
  sourcePageId?: string | null,
  transclusionId?: string | null,
): string {
  return `${sourcePageId ?? ''}:${transclusionId ?? ''}`;
}

export function getTransclusionPresentationAttributes(): Record<
  string,
  string
> {
  return {
    'data-docmost-transclusion': 'true',
    style: TRANSCLUSION_PRESENTATION_STYLE,
  };
}

export function formatTransclusionMarkdown(
  markdown: string,
  strings: TransclusionPresentationStrings,
): string {
  const content = markdown.trim() || strings.unavailable;
  const quotedContent = content
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');

  return `\n\n> **${strings.label}**\n>\n${quotedContent}\n\n`;
}

export function materializeTransclusionsForPresentation<T>(
  document: T,
  resolutions: TransclusionPresentationMap,
  strings: TransclusionPresentationStrings,
): T {
  return visitNode(document, resolutions, strings) as T;
}

export function collectTransclusionPresentationReferences(
  document: unknown,
): Array<{ sourcePageId: string; transclusionId: string }> {
  const references = new Map<
    string,
    { sourcePageId: string; transclusionId: string }
  >();

  collectReferences(document, references);
  return Array.from(references.values());
}

function collectReferences(
  value: unknown,
  output: Map<string, { sourcePageId: string; transclusionId: string }>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const node = value as Record<string, any>;
  if (
    node.type === 'transclusionReference' &&
    typeof node.attrs?.sourcePageId === 'string' &&
    typeof node.attrs?.transclusionId === 'string'
  ) {
    const reference = {
      sourcePageId: node.attrs.sourcePageId,
      transclusionId: node.attrs.transclusionId,
    };
    output.set(
      getTransclusionReferenceKey(
        reference.sourcePageId,
        reference.transclusionId,
      ),
      reference,
    );
  }

  if (Array.isArray(node.content)) {
    for (const item of node.content) collectReferences(item, output);
  }
}

function visitNode(
  value: unknown,
  resolutions: TransclusionPresentationMap,
  strings: TransclusionPresentationStrings,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => visitNode(item, resolutions, strings));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const node = value as Record<string, any>;
  if (node.type === 'transclusionReference') {
    const key = getTransclusionReferenceKey(
      node.attrs?.sourcePageId,
      node.attrs?.transclusionId,
    );
    const resolution = getResolution(resolutions, key);
    const content = getDocumentContent(resolution?.content);

    return {
      type: 'transclusionSource',
      attrs: { id: node.attrs?.transclusionId ?? null },
      content:
        resolution && !resolution.status && content.length > 0
          ? content.map((item) => visitNode(item, resolutions, strings))
          : [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: strings.unavailable }],
              },
            ],
    };
  }

  const copy: Record<string, any> = { ...node };
  if (Array.isArray(node.content)) {
    copy.content = node.content.map((item: unknown) =>
      visitNode(item, resolutions, strings),
    );
  }
  return copy;
}

function getResolution(
  resolutions: TransclusionPresentationMap,
  key: string,
): TransclusionPresentationResolution | undefined {
  if (resolutions instanceof Map) {
    return resolutions.get(key);
  }
  return resolutions[key];
}

function getDocumentContent(content: unknown): Array<Record<string, any>> {
  if (!content || typeof content !== 'object') {
    return [];
  }

  const document = content as Record<string, any>;
  return Array.isArray(document.content) ? document.content : [];
}
