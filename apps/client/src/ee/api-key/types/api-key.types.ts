import { IUser } from "@/features/user/types/user.types.ts";

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
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  creator: Partial<IUser>;
  space?: IApiKeySpace;
}

export interface ICreateApiKeyRequest {
  name: string;
  spaceId: string;
  expiresAt?: string;
}

export interface IUpdateApiKeyRequest {
  apiKeyId: string;
  name: string;
}
