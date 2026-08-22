export enum EventName {
  PAGE_CREATED = 'page.created',
  PAGE_UPDATED = 'page.updated',
  PAGE_DELETED = 'page.deleted',
  PAGE_SOFT_DELETED = 'page.soft_deleted',
  PAGE_RESTORED = 'page.restored',

  SPACE_UPDATED = 'space.updated',
  SPACE_DELETED = 'space.deleted',

  WORKSPACE_DELETED = 'workspace.deleted',
  WORKSPACE_MEMBER_DEACTIVATED = 'workspace.member.deactivated',

  AUTHORIZATION_CHANGED = 'authorization.changed',
  RAG_SYNC_SCOPE_CHANGED = 'rag-sync.scope.changed',
  DICTIONARY_CHANGED = 'dictionary.changed',
  USER_DISPLAY_NAME_CHANGED = 'user.display_name.changed',
}
