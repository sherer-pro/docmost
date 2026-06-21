import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { COMMENT_LIMIT } from '../comment.constants';

export interface CommentPaginationOptions {
  limit: number;
  cursor?: string;
  beforeCursor?: string;
}

export class PageIdDto {
  @IsString()
  pageId: string;
}

export class CommentIdDto {
  @IsUUID()
  commentId: string;
}

export class PageCommentsQueryDto implements CommentPaginationOptions {
  @IsString()
  pageId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COMMENT_LIMIT)
  limit = COMMENT_LIMIT;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  beforeCursor?: string;
}
