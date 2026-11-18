import type { Generated, Json, Timestamp } from './db';

export interface McpWriteOperationRow {
  keyId: string;
  operationId: string;
  actorId: string;
  tool: string;
  spaceId: string;
  pageId: string | null;
  threadId: string | null;
  expectedRevision: string;
  payloadHash: string;
  previewHash: string;
  startedAt: Timestamp | null;
  result: Json | null;
  createdAt: Generated<Timestamp>;
}
