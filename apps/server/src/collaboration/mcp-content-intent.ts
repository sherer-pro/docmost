import type { Document } from '@hocuspocus/server';
import type { McpContentCommand } from './collaboration-document.port';

export type McpContentIntent = Omit<McpContentCommand, 'edit'>;

// Only commands from the authenticated API process can attach a receipt to
// a document. Client-authored Yjs data cannot claim or remove this intent.
export const mcpContentIntents = new WeakMap<Document, McpContentIntent>();
