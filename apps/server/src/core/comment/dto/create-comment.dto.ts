import { IsIn, IsJSON, IsOptional, IsString, IsUUID } from 'class-validator';

export const CommentType = {
  INLINE: 'inline',
  PAGE: 'page',
} as const;

export type CommentType = (typeof CommentType)[keyof typeof CommentType];

export class CreateCommentDto {
  @IsString()
  pageId: string;

  @IsJSON()
  content: any;

  @IsOptional()
  @IsString()
  selection: string;

  @IsOptional()
  @IsUUID()
  parentCommentId: string;

  @IsOptional()
  @IsIn([CommentType.INLINE, CommentType.PAGE])
  type?: CommentType;
}
