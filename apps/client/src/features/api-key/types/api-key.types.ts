import { IUser } from "@/features/user/types/user.types.ts";
import type { McpClientPreset } from "@/features/api-key/utils/mcp-presets.ts";

export type { McpClientPreset };

export interface ApiKeyQueryParams {
  query?: string;
  cursor?: string;
  beforeCursor?: string;
  limit?: number;
  adminView?: boolean;
  keyType?: "rag" | "mcp";
}

export interface IApiKeySpace {
  id: string;
  name: string;
  slug: string;
}

export interface IApiKey {
  id: string;
  name: string;
  token?: string;
  creatorId: string;
  workspaceId: string;
  spaceId: string;
  keyType: "rag" | "mcp";
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  creator: Partial<IUser>;
  space?: IApiKeySpace;
}

export interface ICreateApiKeyRequest {
  name: string;
  spaceId: string;
  keyType?: "rag" | "mcp";
  expiresAt?: string;
}

export interface IUpdateApiKeyRequest {
  apiKeyId: string;
  name: string;
}
