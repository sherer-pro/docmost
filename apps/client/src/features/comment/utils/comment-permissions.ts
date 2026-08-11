export function getCommentActionPermissions(input: {
  isOwner: boolean;
  isAdmin: boolean;
  canComment: boolean;
  canResolve: boolean;
  isReply: boolean;
}) {
  return {
    canEdit: input.isOwner && input.canComment,
    canDelete: input.canComment && (input.isOwner || input.isAdmin),
    canResolve: input.canResolve && !input.isReply,
  };
}
