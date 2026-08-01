export enum QueueName {
  EMAIL_QUEUE = '{email-queue}',
  ATTACHMENT_QUEUE = '{attachment-queue}',
  GENERAL_QUEUE = '{general-queue}',
  FILE_TASK_QUEUE = '{file-task-queue}',
  SEARCH_QUEUE = '{search-queue}',
  AI_CHAT_QUEUE = '{ai-chat-queue}',
  HISTORY_QUEUE = '{history-queue}',
  NOTIFICATION_QUEUE = '{notification-queue}',
}

export enum QueueJob {
  SEND_EMAIL = 'send-email',
  DELETE_SPACE_ATTACHMENTS = 'delete-space-attachments',
  ATTACHMENT_INDEX_CONTENT = 'attachment-index-content',
  ATTACHMENT_INDEXING = 'attachment-indexing',
  DELETE_PAGE_ATTACHMENTS = 'delete-page-attachments',

  DELETE_USER_AVATARS = 'delete-user-avatars',

  PAGE_BACKLINKS = 'page-backlinks',
  ADD_PAGE_WATCHERS = 'add-page-watchers',
  DUPLICATE_PAGE_ATTACHMENTS = 'duplicate-page-attachments',

  IMPORT_TASK = 'import-task',
  EXPORT_TASK = 'export-task',

  SEARCH_INDEX_ATTACHMENT = 'search-index-attachment',
  TYPESENSE_FLUSH = 'typesense-flush',

  PAGE_CREATED = 'page-created',
  PAGE_UPDATED = 'page-updated',
  PAGE_SOFT_DELETED = 'page-soft-deleted',
  PAGE_RESTORED = 'page-restored',
  PAGE_DELETED = 'page-deleted',

  SPACE_CREATED = 'space-created',
  SPACE_UPDATED = 'space-updated',
  SPACE_DELETED = 'space-deleted',

  WORKSPACE_CREATED = 'workspace-created',
  WORKSPACE_SPACE_UPDATED = 'workspace-updated',
  WORKSPACE_DELETED = 'workspace-deleted',
  AI_CHAT_RUN = 'ai-chat-run',
  AI_AUX_RUN = 'ai-aux-run',
  AI_CHAT_FILE_EXTRACT = 'ai-chat-file-extract',
  AI_CHAT_RETENTION_CLEANUP = 'ai-chat-retention-cleanup',

  PAGE_HISTORY = 'page-history',
  PAGE_HISTORY_EVENT_FLUSH = 'page-history-event-flush',

  COMMENT_NOTIFICATION = 'comment-notification',
  COMMENT_RESOLVED_NOTIFICATION = 'comment-resolved-notification',
  PAGE_MENTION_NOTIFICATION = 'page-mention-notification',
  PAGE_RECIPIENT_NOTIFICATION = 'page-recipient-notification',
  PUSH_AGGREGATION_PROCESS = 'push-aggregation-process',
  EMAIL_AGGREGATION_PROCESS = 'email-aggregation-process',
}
