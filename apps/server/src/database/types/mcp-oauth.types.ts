import type { Generated, Json, Timestamp } from './db';

export interface McpOauthSettings {
  workspaceId: string;
  enabled: boolean;
  updatedAt: Generated<Timestamp>;
}

export interface McpOauthClients {
  id: string;
  workspaceId: string;
  name: string;
  redirectUris: Json;
  createdAt: Generated<Timestamp>;
}

export interface McpOauthAuthorizations {
  id: string;
  workspaceId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  state: string | null;
  challenge: string;
  expiresAt: Timestamp;
  decidedAt: Timestamp | null;
  codeHash: string | null;
  codeExpiresAt: Timestamp | null;
  codeUsedAt: Timestamp | null;
  createdAt: Generated<Timestamp>;
}

export interface McpOauthGrants {
  id: string;
  authorizationId: string;
  workspaceId: string;
  clientId: string;
  userId: string;
  spaceId: string;
  spaceName: string;
  sessionId: string;
  resource: string;
  capabilities: Json;
  createdAt: Generated<Timestamp>;
  expiresAt: Timestamp;
  revokedAt: Timestamp | null;
  lastUsedAt: Timestamp | null;
}

export interface McpOauthTokens {
  hash: string;
  grantId: string;
  kind: 'access' | 'refresh';
  expiresAt: Timestamp;
  usedAt: Timestamp | null;
}
