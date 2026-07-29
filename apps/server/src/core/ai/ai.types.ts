export type AiProviderMessage = {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | {
            type: 'image_url';
            image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
          }
      >;
};

export type AiProviderConfig = {
  baseUrl: string;
  apiKey?: string | null;
  chatModel: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
};

export type AiProviderUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AiRetrievalConfig = {
  adapter: 'none' | 'http-json-v1' | 'open-webui-knowledge-v1';
  url: string | null;
  apiKey: string | null;
  openWebUiBaseUrl?: string | null;
  openWebUiApiKey?: string | null;
  openWebUiKnowledgeId?: string | null;
  timeoutMs: number;
  maxResults: number;
};

export type AiRetrievalRequest = {
  schemaVersion: 1;
  requestId: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  query: string;
  allowedPageIds: string[];
  sourceTypes: Array<'page' | 'database_row' | 'attachment'>;
  limit: number;
  candidateLimit: number;
};

export type AiRetrievalHit = {
  sourceType: 'page' | 'database_row' | 'attachment';
  sourceId: string;
  pageId: string;
  text: string;
  score?: number;
};

export type AiSafeRetrievalSource = {
  sourceType: 'page' | 'database_row' | 'attachment';
  sourceId: string;
  pageId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  excerpt: string;
  relevanceScore: number | null;
};
