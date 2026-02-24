export const NotificationType = {
  COMMENT_USER_MENTION: 'comment.user_mention',
  COMMENT_CREATED: 'comment.created',
  COMMENT_REPLY: 'comment.reply',
  COMMENT_RESOLVED: 'comment.resolved',
  PAGE_USER_MENTION: 'page.user_mention',
  PAGE_UPDATED_FOR_ASSIGNEE_OR_STAKEHOLDER:
    'page.updated_for_assignee_or_stakeholder',
  PAGE_ASSIGNED: 'page.assigned',
  PAGE_STAKEHOLDER_ADDED: 'page.stakeholder_added',
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];
