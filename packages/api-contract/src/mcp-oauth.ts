export interface McpOAuthConsent {
  id: string;
  clientName: string;
  redirectUri: string;
  resource: string;
  scope: "mcp:read";
  expiresAt: string;
}

export interface McpOAuthConnection {
  id: string;
  clientName: string;
  spaceName: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
