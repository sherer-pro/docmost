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
export const QuoteSourceMark = {} as any;
export const QuoteEmbed = {} as any;

export function addUniqueIdsToDoc(doc: any) { return doc; }
export function htmlToMarkdown(input: string) { return input; }
export function markdownToHtml(input: string) { return input; }
export function getEmbedUrlAndProvider(url: string) { return { url, provider: null }; }
