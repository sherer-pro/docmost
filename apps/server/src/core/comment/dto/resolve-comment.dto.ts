import { IsBoolean, IsUUID } from 'class-validator';

/**
 * DTO для изменения статуса комментария (решён/открыт).
 *
 * `pageId` передаётся клиентом и валидируется вместе с `commentId`,
 * чтобы контроллер мог гарантировать, что комментарий действительно
 * принадлежит указанной странице.
 */
export class ResolveCommentDto {
  @IsUUID()
  commentId: string;

  @IsUUID()
  pageId: string;

  @IsBoolean()
  resolved: boolean;
}
