import { Injectable } from '@nestjs/common';
import { Page, User } from '@docmost/db/types/entity.types';
import {
  CommentRepo,
  CommentWithActors,
} from '@docmost/db/repos/comment/comment.repo';
import { jsonToMarkdown } from '../../collaboration/collaboration.util';
import { ExportFormat } from './dto/export-dto';
import { ExportService } from './export.service';

type ProseMirrorJsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{
    type?: string;
    attrs?: Record<string, unknown>;
  }>;
  content?: ProseMirrorJsonNode[];
};

type HeadingContext = {
  level: number;
  text: string;
};

type CommentLocationContext = {
  section: string;
  markdownLine: number;
  contextText: string;
  markedText: string;
};

type CommentContextState = {
  contexts: Map<string, CommentLocationContext>;
  headingStack: HeadingContext[];
  nextMarkdownLine: number;
};

@Injectable()
export class CopyMarkdownWithCommentsService {
  constructor(
    private readonly exportService: ExportService,
    private readonly commentRepo: CommentRepo,
  ) {}

  async build(page: Page, user: User, locale?: string): Promise<string> {
    const pageMarkdown =
      (
        await this.exportService.exportPage(
          ExportFormat.Markdown,
          page,
          true,
          locale,
          undefined,
          undefined,
          user,
        )
      )
        ?.toString()
        .trim() ?? '';

    const comments = await this.commentRepo.findAllPageCommentsWithActors(
      page.id,
    );

    if (comments.length === 0) {
      return pageMarkdown;
    }

    const commentContexts = this.buildCommentLocationContexts(
      page,
      pageMarkdown,
    );

    return [
      pageMarkdown,
      '---',
      '## Comments',
      this.buildCommentsMarkdown(comments, commentContexts),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildCommentsMarkdown(
    comments: CommentWithActors[],
    commentContexts: Map<string, CommentLocationContext>,
  ): string {
    const commentIds = new Set(comments.map((comment) => comment.id));
    const childCommentsByParentId = new Map<string, CommentWithActors[]>();

    for (const comment of comments) {
      if (!comment.parentCommentId) {
        continue;
      }

      const existing =
        childCommentsByParentId.get(comment.parentCommentId) ?? [];
      existing.push(comment);
      childCommentsByParentId.set(comment.parentCommentId, existing);
    }

    return comments
      .filter(
        (comment) =>
          !comment.parentCommentId || !commentIds.has(comment.parentCommentId),
      )
      .map((comment, index) =>
        this.buildThreadMarkdown(
          comment,
          index + 1,
          childCommentsByParentId,
          commentContexts,
        ),
      )
      .join('\n\n');
  }

  private buildThreadMarkdown(
    comment: CommentWithActors,
    index: number,
    childCommentsByParentId: Map<string, CommentWithActors[]>,
    commentContexts: Map<string, CommentLocationContext>,
  ): string {
    const commentType = this.getCommentTypeLabel(comment);
    const status = this.getCommentStatusLabel(comment);
    const rootMarkdown = this.buildCommentEntryMarkdown(
      comment,
      `### Thread ${index}: ${commentType} (${status})`,
      commentContexts.get(comment.id),
    );
    const replies = this.buildReplyMarkdown(
      comment.id,
      `${index}`,
      childCommentsByParentId,
    );

    return [rootMarkdown, replies].filter(Boolean).join('\n\n');
  }

  private buildReplyMarkdown(
    parentCommentId: string,
    prefix: string,
    childCommentsByParentId: Map<string, CommentWithActors[]>,
  ): string {
    const children = childCommentsByParentId.get(parentCommentId) ?? [];

    return children
      .map((comment, index) => {
        const replyPrefix = `${prefix}.${index + 1}`;
        return [
          this.buildCommentEntryMarkdown(comment, `#### Reply ${replyPrefix}`),
          this.buildReplyMarkdown(
            comment.id,
            replyPrefix,
            childCommentsByParentId,
          ),
        ]
          .filter(Boolean)
          .join('\n\n');
      })
      .join('\n\n');
  }

  private buildCommentEntryMarkdown(
    comment: CommentWithActors,
    heading: string,
    context?: CommentLocationContext,
  ): string {
    const metadata = [
      this.buildMetadataLine('Type', this.getCommentTypeLabel(comment)),
      this.buildMetadataLine('Status', this.getCommentStatusLabel(comment)),
      ...this.buildLocationMetadata(comment, context),
      this.buildMetadataLine('Author', this.getActorName(comment)),
      this.buildMetadataLine('Created', this.toIsoDate(comment.createdAt)),
      comment.resolvedAt
        ? this.buildMetadataLine(
            'Resolved at',
            this.toIsoDate(comment.resolvedAt),
          )
        : null,
      comment.resolvedAt
        ? this.buildMetadataLine(
            'Resolved by',
            this.getActorName(comment, true),
          )
        : null,
    ].filter(Boolean);
    const selection = this.formatSelection(comment.selection);
    const body = this.contentToMarkdown(comment.content) || '_No content_';

    return [
      heading,
      metadata.join('\n'),
      selection,
      ['Body:', body].join('\n\n'),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildLocationMetadata(
    comment: CommentWithActors,
    context?: CommentLocationContext,
  ): string[] {
    if (comment.parentCommentId) {
      return [];
    }

    if (comment.type === 'page') {
      return [this.buildMetadataLine('Location', 'Page-level')];
    }

    if (!context) {
      return [this.buildMetadataLine('Location', 'Inline anchor not found')];
    }

    const metadata = [
      this.buildMetadataLine('Section', context.section),
      this.buildMetadataLine('Markdown line', String(context.markdownLine)),
    ];

    if (context.contextText) {
      metadata.push(this.buildMetadataLine('Context', context.contextText));
    }

    if (
      context.markedText &&
      this.normalizeMetadataValue(context.markedText) !==
        this.normalizeMetadataValue(comment.selection ?? '')
    ) {
      metadata.push(this.buildMetadataLine('Marked text', context.markedText));
    }

    return metadata;
  }

  private buildCommentLocationContexts(
    page: Page,
    pageMarkdown: string,
  ): Map<string, CommentLocationContext> {
    const doc = this.toProseMirrorJsonNode(page.content);
    const state: CommentContextState = {
      contexts: new Map<string, CommentLocationContext>(),
      headingStack: [],
      nextMarkdownLine: this.getFirstContentMarkdownLine(page, pageMarkdown),
    };

    if (!Array.isArray(doc.content)) {
      return state.contexts;
    }

    for (const child of doc.content) {
      this.visitMarkdownBlock(child, state);
    }

    const exactLines = this.buildExactMarkdownLineMap(doc, page, pageMarkdown);
    for (const [commentId, markdownLine] of exactLines) {
      const context = state.contexts.get(commentId);
      if (context) {
        context.markdownLine = markdownLine;
      }
    }

    return state.contexts;
  }

  private buildExactMarkdownLineMap(
    doc: ProseMirrorJsonNode,
    page: Page,
    pageMarkdown: string,
  ): Map<string, number> {
    const markerByCommentId = new Map<string, string>();
    let markerPrefix = 'DOCMOSTCOMMENTANCHOR';
    const documentText = this.extractNodeText(doc);
    while (documentText.includes(markerPrefix)) {
      markerPrefix += 'X';
    }

    const markedDoc = this.cloneWithCommentLineMarkers(
      doc,
      markerPrefix,
      markerByCommentId,
    );
    if (markerByCommentId.size === 0) {
      return new Map();
    }

    try {
      const markedMarkdown = jsonToMarkdown(markedDoc);
      const markedLines = markedMarkdown.split(/\r?\n/);
      const firstContentLine = this.getFirstContentMarkdownLine(
        page,
        pageMarkdown,
      );
      const lineByCommentId = new Map<string, number>();

      for (const [commentId, marker] of markerByCommentId) {
        const lineIndex = markedLines.findIndex((line) =>
          line.includes(marker),
        );
        if (lineIndex >= 0) {
          lineByCommentId.set(commentId, firstContentLine + lineIndex);
        }
      }

      return lineByCommentId;
    } catch {
      return new Map();
    }
  }

  private cloneWithCommentLineMarkers(
    node: ProseMirrorJsonNode,
    markerPrefix: string,
    markerByCommentId: Map<string, string>,
  ): ProseMirrorJsonNode {
    let text = node.text;
    if (node.type === 'text' && text && Array.isArray(node.marks)) {
      const markers: string[] = [];
      for (const mark of node.marks) {
        const commentId =
          mark.type === 'comment' && typeof mark.attrs?.commentId === 'string'
            ? mark.attrs.commentId.trim()
            : '';
        if (!commentId || markerByCommentId.has(commentId)) {
          continue;
        }

        const marker = `${markerPrefix}${markerByCommentId.size + 1}Z`;
        markerByCommentId.set(commentId, marker);
        markers.push(marker);
      }
      if (markers.length > 0) {
        text = `${markers.join('')} ${text}`;
      }
    }

    return {
      ...node,
      ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
      ...(node.marks
        ? {
            marks: node.marks.map((mark) => ({
              ...mark,
              ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}),
            })),
          }
        : {}),
      ...(typeof text === 'string' ? { text } : {}),
      ...(node.content
        ? {
            content: node.content.map((child) =>
              this.cloneWithCommentLineMarkers(
                child,
                markerPrefix,
                markerByCommentId,
              ),
            ),
          }
        : {}),
    };
  }

  private toProseMirrorJsonNode(content: unknown): ProseMirrorJsonNode {
    if (!content || typeof content !== 'object') {
      return { type: 'doc', content: [] };
    }

    const candidate = content as ProseMirrorJsonNode;
    return {
      ...candidate,
      content: Array.isArray(candidate.content) ? candidate.content : [],
    };
  }

  private getFirstContentMarkdownLine(
    page: Page,
    pageMarkdown: string,
  ): number {
    const title = page.title?.trim();
    const firstLine = pageMarkdown.split(/\r?\n/, 1)[0]?.trim() ?? '';

    if (title && firstLine.startsWith('#')) {
      return 3;
    }

    return 1;
  }

  private visitMarkdownBlock(
    node: ProseMirrorJsonNode,
    state: CommentContextState,
  ): void {
    const type = node.type;

    if (type === 'heading') {
      this.visitHeadingBlock(node, state);
      return;
    }

    if (this.isSimpleTextBlock(type)) {
      this.captureCommentContextsFromBlock(node, state.nextMarkdownLine, state);
      state.nextMarkdownLine += this.estimateMarkdownLineSpan(node) + 1;
      return;
    }

    if (this.isListBlock(type)) {
      this.visitListBlock(node, state);
      state.nextMarkdownLine += 1;
      return;
    }

    if (type === 'table') {
      this.visitTableBlock(node, state);
      state.nextMarkdownLine += 1;
      return;
    }

    if (Array.isArray(node.content) && node.content.length > 0) {
      for (const child of node.content) {
        this.visitMarkdownBlock(child, state);
      }
      return;
    }

    if (this.extractNodeText(node)) {
      this.captureCommentContextsFromBlock(node, state.nextMarkdownLine, state);
      state.nextMarkdownLine += this.estimateMarkdownLineSpan(node) + 1;
    }
  }

  private visitHeadingBlock(
    node: ProseMirrorJsonNode,
    state: CommentContextState,
  ): void {
    const headingText = this.normalizeContextText(this.extractNodeText(node));
    const level = this.normalizeHeadingLevel(node.attrs?.level);

    this.updateHeadingStack(state.headingStack, level, headingText);
    this.captureCommentContextsFromBlock(node, state.nextMarkdownLine, state);
    state.nextMarkdownLine += this.estimateMarkdownLineSpan(node) + 1;
  }

  private visitListBlock(
    node: ProseMirrorJsonNode,
    state: CommentContextState,
  ): void {
    if (!Array.isArray(node.content)) {
      return;
    }

    for (const child of node.content) {
      this.visitListItemBlock(child, state);
    }
  }

  private visitListItemBlock(
    node: ProseMirrorJsonNode,
    state: CommentContextState,
  ): void {
    if (!Array.isArray(node.content) || node.content.length === 0) {
      this.captureCommentContextsFromBlock(node, state.nextMarkdownLine, state);
      state.nextMarkdownLine += 1;
      return;
    }

    for (const child of node.content) {
      this.visitMarkdownBlock(child, state);
    }
  }

  private visitTableBlock(
    node: ProseMirrorJsonNode,
    state: CommentContextState,
  ): void {
    const rows =
      node.content?.filter((child) => child.type === 'tableRow') ?? [];

    for (const row of rows) {
      this.captureCommentContextsFromBlock(row, state.nextMarkdownLine, state);
      state.nextMarkdownLine += 1;
    }

    if (rows.length > 0) {
      state.nextMarkdownLine += 1;
    }
  }

  private captureCommentContextsFromBlock(
    node: ProseMirrorJsonNode,
    markdownLine: number,
    state: CommentContextState,
  ): void {
    const blockText = this.truncateMetadataText(
      this.normalizeContextText(this.extractNodeText(node)),
    );
    const markedTextByCommentId = new Map<string, string[]>();

    this.collectMarkedTextByCommentId(node, markedTextByCommentId);

    for (const [commentId, markedTextParts] of markedTextByCommentId) {
      const markedText = this.truncateMetadataText(
        this.normalizeContextText(markedTextParts.join('')),
      );
      const existing = state.contexts.get(commentId);

      if (existing) {
        existing.markedText = this.truncateMetadataText(
          this.normalizeContextText(`${existing.markedText} ${markedText}`),
        );
        continue;
      }

      state.contexts.set(commentId, {
        section: this.getCurrentSection(state.headingStack),
        markdownLine,
        contextText: blockText,
        markedText,
      });
    }
  }

  private collectMarkedTextByCommentId(
    node: ProseMirrorJsonNode,
    markedTextByCommentId: Map<string, string[]>,
  ): void {
    if (node.type === 'text' && node.text && Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        const commentId =
          mark.type === 'comment' && typeof mark.attrs?.commentId === 'string'
            ? mark.attrs.commentId.trim()
            : '';

        if (!commentId) {
          continue;
        }

        const markedText = markedTextByCommentId.get(commentId) ?? [];
        markedText.push(node.text);
        markedTextByCommentId.set(commentId, markedText);
      }
    }

    if (!Array.isArray(node.content)) {
      return;
    }

    for (const child of node.content) {
      this.collectMarkedTextByCommentId(child, markedTextByCommentId);
    }
  }

  private extractNodeText(node: ProseMirrorJsonNode): string {
    if (node.type === 'text') {
      return node.text ?? '';
    }

    if (!Array.isArray(node.content)) {
      return '';
    }

    return node.content.map((child) => this.extractNodeText(child)).join('');
  }

  private isSimpleTextBlock(type?: string): boolean {
    return [
      'paragraph',
      'heading',
      'codeBlock',
      'mathBlock',
      'blockquote',
      'callout',
      'detailsSummary',
    ].includes(type ?? '');
  }

  private isListBlock(type?: string): boolean {
    return ['bulletList', 'orderedList', 'taskList'].includes(type ?? '');
  }

  private estimateMarkdownLineSpan(node: ProseMirrorJsonNode): number {
    const textLineCount = Math.max(
      1,
      this.extractNodeText(node).split(/\r?\n/).length,
    );

    if (node.type === 'codeBlock') {
      return textLineCount + 2;
    }

    return textLineCount;
  }

  private updateHeadingStack(
    headingStack: HeadingContext[],
    level: number,
    text: string,
  ): void {
    while (
      headingStack.length > 0 &&
      headingStack[headingStack.length - 1].level >= level
    ) {
      headingStack.pop();
    }

    if (text) {
      headingStack.push({ level, text });
    }
  }

  private normalizeHeadingLevel(level: unknown): number {
    if (typeof level !== 'number' || !Number.isFinite(level)) {
      return 1;
    }

    return Math.max(1, Math.min(6, Math.trunc(level)));
  }

  private getCurrentSection(headingStack: HeadingContext[]): string {
    const section = headingStack.map((heading) => heading.text).join(' > ');
    return section || 'Document root';
  }

  private normalizeContextText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private truncateMetadataText(value: string): string {
    const normalizedValue = this.normalizeContextText(value);

    if (normalizedValue.length <= 280) {
      return normalizedValue;
    }

    return `${normalizedValue.slice(0, 277).trimEnd()}...`;
  }

  private buildMetadataLine(label: string, value: string): string {
    return `- ${label}: ${this.normalizeMetadataValue(value)}`;
  }

  private getCommentTypeLabel(comment: CommentWithActors): string {
    return comment.type === 'page' ? 'Page' : 'Inline';
  }

  private getCommentStatusLabel(comment: CommentWithActors): string {
    return comment.resolvedAt ? 'Resolved' : 'Open';
  }

  private getActorName(
    comment: CommentWithActors,
    useResolvedBy = false,
  ): string {
    const actor = useResolvedBy ? comment.resolvedBy : comment.creator;
    return actor?.name ?? comment.creatorId ?? 'Unknown';
  }

  private toIsoDate(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toISOString();
  }

  private normalizeMetadataValue(value: string): string {
    return value.replace(/\s+/g, ' ').trim() || 'Unknown';
  }

  private formatSelection(selection: string | null): string {
    const normalizedSelection = selection?.trim();
    if (!normalizedSelection) {
      return '';
    }

    return [
      'Selection:',
      normalizedSelection
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join('\n'),
    ].join('\n\n');
  }

  private contentToMarkdown(content: unknown): string {
    if (content === null || typeof content === 'undefined') {
      return '';
    }

    if (typeof content === 'string') {
      return content.trim();
    }

    if (typeof content !== 'object') {
      return String(content).trim();
    }

    try {
      return jsonToMarkdown(content).trim();
    } catch {
      return '';
    }
  }
}
