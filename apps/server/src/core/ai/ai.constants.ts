import {
  AI_RETRIEVAL_CONFIG_DEFAULTS,
  AI_SPACE_CONFIG_DEFAULTS,
} from '@docmost/api-contract';

export const AI_DEFAULTS = AI_SPACE_CONFIG_DEFAULTS;

export const AI_CONCURRENCY_LIMITS = {
  perUser: 6,
  perSpace: 30,
  perConversation: 1,
} as const;

export const AI_CHAT_LIMITS = {
  maxDocumentSnapshotChars: 1000000,
  maxSelectionChars: 200000,
  maxMessageChars: 32000,
  maxFilesPerConversation: 10,
  maxFileBytes: 25 * 1024 * 1024,
  maxConversationFileBytes: 100 * 1024 * 1024,
  maxExtractedTextChars: 1000000,
};

export const AI_ALLOWED_CHAT_FILE_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
] as const;

export const AI_ALLOWED_CHAT_FILE_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const AI_RETRIEVAL_DEFAULTS = {
  adapter: AI_RETRIEVAL_CONFIG_DEFAULTS.adapter,
  timeoutMs: AI_RETRIEVAL_CONFIG_DEFAULTS.timeoutMs,
  topK: AI_RETRIEVAL_CONFIG_DEFAULTS.maxResults,
  candidateLimit: 40,
  maxHitChars: 16 * 1024,
  maxResponseChars: 256 * 1024,
  maxRequestChars: 1024 * 1024,
};
