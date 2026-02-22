import { IsBoolean, IsUUID } from 'class-validator';

/**
 * DTO for changing comment status (resolved/open).
 *
 * `pageId` is sent by the client and validated with `commentId`
 * so the controller can guarantee the comment actually
 * belongs to the specified page.
 */
export class ResolveCommentDto {
  @IsUUID()
  commentId: string;

  @IsUUID()
  pageId: string;

  @IsBoolean()
  resolved: boolean;
}
