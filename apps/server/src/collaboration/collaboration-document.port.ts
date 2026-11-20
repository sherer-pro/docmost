import type { User } from '@docmost/db/types/entity.types';
import type { AiPageOperation } from '../common/helpers/prosemirror/ai-page-operation';
import type { McpContentEdit } from '../common/helpers/prosemirror/mcp-content-edit';
import type { DrawioSource } from './services/drawio-source.service';

export const COLLABORATION_DOCUMENT_PORT = Symbol(
  'COLLABORATION_DOCUMENT_PORT',
);

export type CollaborationActor = Pick<User, 'id'>;

export type McpContentCommand = {
  diagram?: {
    source: DrawioSource;
    attachmentId: string;
    filePath: string;
    size: number;
    modelSha256: string;
    svgSha256: string;
  };
  edit: McpContentEdit;
  baseHash: string;
  afterHash: string;
  keyId: string;
  operationId: string;
  previewHash: string;
  user: CollaborationActor;
};

export interface CollaborationCommandHandlers {
  applyMcpContentEdit: (
    documentName: string,
    payload: McpContentCommand,
  ) => Promise<void>;
  updatePageContent: (
    documentName: string,
    payload: {
      prosemirrorJson: unknown;
      operation: string;
      user: CollaborationActor;
    },
  ) => Promise<void>;
  applyAiPageOperation: (
    documentName: string,
    payload: {
      operation: AiPageOperation;
      baseContentHash: string;
      expectedAfterHash: string;
      user: CollaborationActor;
    },
  ) => Promise<{ beforeHash: string; afterHash: string }>;
  applyPageTemplateMutation: (
    documentName: string,
    payload: {
      originalContent: unknown;
      nextContent: unknown;
      baseContentHash: string;
      mutationId: string;
      operationLeaseToken: string;
      workspaceId: string;
      systemSyncRevision?: number;
      user: CollaborationActor;
    },
  ) => Promise<{ beforeHash: string; afterHash: string }>;
  getAiPageContentHash: (
    documentName: string,
    payload: { user: CollaborationActor },
  ) => Promise<string>;
  getAiPageContent: (
    documentName: string,
    payload: { user: CollaborationActor },
  ) => Promise<unknown>;
}

export type CollaborationCommandName = keyof CollaborationCommandHandlers;

export interface CollaborationDocumentPort {
  applyMcpContentEdit(
    documentName: string,
    payload: McpContentCommand,
  ): Promise<void>;
  updatePageContent(
    documentName: string,
    payload: Parameters<CollaborationCommandHandlers['updatePageContent']>[1],
  ): ReturnType<CollaborationCommandHandlers['updatePageContent']>;
  applyAiPageOperation(
    documentName: string,
    payload: Parameters<
      CollaborationCommandHandlers['applyAiPageOperation']
    >[1],
  ): ReturnType<CollaborationCommandHandlers['applyAiPageOperation']>;
  applyPageTemplateMutation(
    documentName: string,
    payload: Parameters<
      CollaborationCommandHandlers['applyPageTemplateMutation']
    >[1],
  ): ReturnType<CollaborationCommandHandlers['applyPageTemplateMutation']>;
  getPageContentHash(
    documentName: string,
    payload: Parameters<
      CollaborationCommandHandlers['getAiPageContentHash']
    >[1],
  ): ReturnType<CollaborationCommandHandlers['getAiPageContentHash']>;
  getPageContent(
    documentName: string,
    payload: Parameters<CollaborationCommandHandlers['getAiPageContent']>[1],
  ): ReturnType<CollaborationCommandHandlers['getAiPageContent']>;
}

export interface CollaborationCommandRequest<
  TName extends CollaborationCommandName = CollaborationCommandName,
> {
  eventName: TName;
  documentName: string;
  payload: Parameters<CollaborationCommandHandlers[TName]>[1];
}
