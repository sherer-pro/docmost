import { IsString, IsUUID } from 'class-validator';
import { PaginationOptions } from '../../../database/pagination/pagination-options';

export class PageIdDto {
  @IsString()
  pageId: string;
}

export class CommentIdDto {
  @IsUUID()
  commentId: string;
}

export class PageCommentsQueryDto extends PaginationOptions {
  @IsString()
  pageId: string;
}
