export enum JwtType {
  ACCESS = 'access',
  COLLAB = 'collab',
  EXCHANGE = 'exchange',
  ATTACHMENT = 'attachment',
  MFA_TOKEN = 'mfa_token',
  API_KEY = 'api_key',
}
export type JwtPayload = {
  sub: string;
  email: string;
  workspaceId: string;
  sessionId?: string;
  type: 'access';
};

export type JwtCollabPayload = {
  sub: string;
  workspaceId: string;
  pageId?: string;
  /**
   * Optional only for tokens minted before session binding was introduced.
   * The collaboration server rejects a token without it.
   */
  sessionId?: string;
  type: 'collab';
};

export type JwtExchangePayload = {
  sub: string;
  workspaceId: string;
  type: 'exchange';
};

export type JwtAttachmentPayload = {
  attachmentId?: string;
  pageId: string;
  pageIds?: string[];
  shareId?: string;
  pageEmbedSource?: boolean;
  workspaceId: string;
  type: 'attachment';
};

export interface JwtMfaTokenPayload {
  sub: string;
  workspaceId: string;
  challengeId: string;
  ssoAuthProviderId?: string;
  targetSpaceId?: string;
  type: 'mfa_token';
}

export type JwtApiKeyPayload = {
  sub: string;
  workspaceId: string;
  spaceId: string;
  apiKeyId: string;
  keyType?: 'rag' | 'mcp';
  type: 'api_key';
};
