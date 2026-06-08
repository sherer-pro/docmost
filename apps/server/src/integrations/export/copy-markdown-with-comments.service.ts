import { Injectable } from '@nestjs/common';
import { Page } from '@docmost/db/types/entity.types';
import {
  CommentRepo,
  CommentWithActors,
} from '@docmost/db/repos/comment/comment.repo';
import { jsonToMarkdown } from '../../collaboration/collaboration.util';
import { ExportFormat } from './dto/export-dto';
import { ExportService } from './export.service';

@Injectable()
export class CopyMarkdownWithCommentsService {
  constructor(
    private readonly exportService: ExportService,
    private readonly commentRepo: CommentRepo,
  ) {}

  async build(page: Page, locale?: string): Promise<string> {
    const pageMarkdown =
      (
        await this.exportService.exportPage(
          ExportFormat.Markdown,
          page,
          true,
          locale,
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

    return [
      pageMarkdown,
      '---',
      '## Comments',
      this.buildCommentsMarkdown(comments),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildCommentsMarkdown(comments: CommentWithActors[]): string {
    const commentIds = new Set(comments.map((comment) => comment.id));
    const childCommentsByParentId = new Map<string, CommentWithActors[]>();

    for (const comment of comments) {
      if (!comment.parentCommentId) {
        continue;
      }

      const existing = childCommentsByParentId.get(comment.parentCommentId) ?? [];
      existing.push(comment);
      childCommentsByParentId.set(comment.parentCommentId, existing);
    }

    return comments
      .filter(
        (comment) =>
          !comment.parentCommentId || !commentIds.has(comment.parentCommentId),
      )
      .map((comment, index) =>
        this.buildThreadMarkdown(comment, index + 1, childCommentsByParentId),
      )
      .join('\n\n');
  }

  private buildThreadMarkdown(
    comment: CommentWithActors,
    index: number,
    childCommentsByParentId: Map<string, CommentWithActors[]>,
  ): string {
    const commentType = this.getCommentTypeLabel(comment);
    const status = this.getCommentStatusLabel(comment);
    const rootMarkdown = this.buildCommentEntryMarkdown(
      comment,
      `### Thread ${index}: ${commentType} (${status})`,
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
          this.buildCommentEntryMarkdown(
            comment,
            `#### Reply ${replyPrefix}`,
          ),
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
  ): string {
    const metadata = [
      this.buildMetadataLine('Type', this.getCommentTypeLabel(comment)),
      this.buildMetadataLine('Status', this.getCommentStatusLabel(comment)),
      this.buildMetadataLine('Author', this.getActorName(comment)),
      this.buildMetadataLine('Created', this.toIsoDate(comment.createdAt)),
      comment.resolvedAt
        ? this.buildMetadataLine('Resolved at', this.toIsoDate(comment.resolvedAt))
        : null,
      comment.resolvedAt
        ? this.buildMetadataLine('Resolved by', this.getActorName(comment, true))
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
