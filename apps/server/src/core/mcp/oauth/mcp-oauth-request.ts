import type { Workspace } from '@docmost/db/types/entity.types';
import { McpOAuthError } from './mcp-oauth-validation';

export function hostWorkspace(request: any): Workspace {
  const workspace = request.raw?.workspace;
  if (!workspace || workspace.deletedAt)
    throw new McpOAuthError('invalid_request', 'Workspace not found', 404);
  return workspace;
}
