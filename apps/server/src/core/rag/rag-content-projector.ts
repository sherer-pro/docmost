import type {
  RagContentCapability,
  RagContentProcessorId,
  RagSyncSourceType,
} from '@docmost/api-contract';

export interface RagSourceLocator {
  pageId: string | null;
  databaseId?: string;
  attachmentId?: string;
  sectionId?: string;
  headingPath?: string[];
  links?: string[];
  pageNumber?: number;
  region?: { x: number; y: number; width: number; height: number };
}

interface RagProjectionPart {
  partId: string;
  fileName: string;
  mimeType: string;
  content: Uint8Array;
  locator: RagSourceLocator;
}

export interface RagProjectionResult {
  projectorId: RagContentProcessorId;
  sourceType: RagSyncSourceType;
  sourceId: string;
  parts: RagProjectionPart[];
}

export interface RagContentProjector<TInput> {
  readonly id: RagContentProcessorId;
  readonly capability: RagContentCapability;
  project(input: TInput): RagProjectionResult;
}

export interface RagAttachmentTextProjectionInput {
  sourceId: string;
  pageId: string;
  fileName: string;
  fileExt: string;
  mimeType: string | null;
  content: Uint8Array;
}

export interface RagStructuredKnowledgeProjectionInput {
  qualityProfile?: 'legacy-v1' | 'evidence-v1';
  headings?: import('./structured-knowledge.util').KnowledgeHeading[];
  sourceType: Exclude<RagSyncSourceType, 'attachment'>;
  sourceId: string;
  pageId: string | null;
  databaseId?: string;
  fileName: string;
  markdown: string;
}
