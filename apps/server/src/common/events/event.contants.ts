export enum EventName {
  COLLAB_PAGE_UPDATED = 'collab.page.updated',
  PAGE_CREATED = 'page.created',
  PAGE_UPDATED = 'page.updated',
  PAGE_DELETED = 'page.deleted',
  PAGE_SOFT_DELETED = 'page.soft_deleted',
  PAGE_RESTORED = 'page.restored',
  PAGE_EMBED_VISIBILITY_CHANGED = 'page_embed.visibility_changed',

  SPACE_CREATED = 'space.created',
  SPACE_UPDATED = 'space.updated',
  SPACE_DELETED = 'space.deleted',

  WORKSPACE_CREATED = 'workspace.created',
  WORKSPACE_UPDATED = 'workspace.updated',
  WORKSPACE_DELETED = 'workspace.deleted',
  WORKSPACE_MEMBER_DEACTIVATED = 'workspace.member.deactivated',

  AUTHORIZATION_CHANGED = 'authorization.changed',
  RAG_SYNC_SCOPE_CHANGED = 'rag-sync.scope.changed',
}
