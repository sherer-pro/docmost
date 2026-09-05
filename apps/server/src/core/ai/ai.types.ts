export type AiProviderMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | null
    | Array<
        | { type: 'text'; text: string }
        | {
            type: 'image_url';
            image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
          }
      >;
  tool_calls?: AiProviderToolCall[];
  tool_call_id?: string;
};

export type AiProviderToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type AiProviderTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AiProviderToolResponse = {
  content: string;
  toolCalls: AiProviderToolCall[];
  usage: AiProviderUsage;
  finishReason: string | null;
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
  queryMode: import('@docmost/api-contract').AiRetrievalQueryMode;
  followUpRewriteEnabled: boolean;
};

export type AiRetrievalRequest = {
  schemaVersion: 1;
  requestId: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  query: string;
  allowedPageIds: string[];
  sourceTypes: Array<
    'page' | 'database_row' | 'attachment' | 'dictionary_term'
  >;
  limit: number;
  candidateLimit: number;
  deadlineAtMs?: number;
};

export type AiRetrievalHit = {
  sourceType: 'page' | 'database_row' | 'attachment' | 'dictionary_term';
  sourceId: string;
  pageId: string | null;
  text: string;
  score?: number;
  partKey?: string;
};

export type AiSafeRetrievalSource = {
  sourceType: 'page' | 'database_row' | 'attachment' | 'dictionary_term';
  sourceId: string;
  pageId: string | null;
  sourceTitle: string;
  sourceUrl: string | null;
  excerpt: string;
  relevanceScore: number | null;
  partKey?: string | null;
  customFields?: import('@docmost/api-contract').RagDocumentCustomFields;
  sectionId?: string | null;
  sectionTitle?: string | null;
};

export type AiCitationCandidate = {
  marker: string;
  candidateKey: string;
  sourceType:
    | 'page'
    | 'database'
    | 'database_row'
    | 'attachment'
    | 'dictionary_term'
    | 'chat_file';
  sourceId: string;
  pageId: string | null;
  sourceTitle: string;
  sourceUrl: string | null;
  excerpt: string | null;
  relevanceScore: number | null;
  sectionId: string | null;
  sectionTitle: string | null;
  root: boolean;
};

export type AiPromptBuildResult = {
  messages: AiProviderMessage[];
  citationCandidates: AiCitationCandidate[];
};
