import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Hocuspocus, Document } from '@hocuspocus/server';
import { TiptapTransformer } from '@hocuspocus/transformer';
import {
  prosemirrorNodeToYElement,
  tiptapExtensions,
} from './collaboration.util';
import * as Y from 'yjs';
import { updateYFragment } from 'y-prosemirror';
import { User } from '@docmost/db/types/entity.types';
import {
  AiPageOperation,
  applyAiPageOperation,
  hashProseMirrorJson,
} from '../common/helpers/prosemirror/ai-page-operation';
import { strictJsonToNode } from './collaboration.util';
import { PageEmbedService } from '../core/page/transclusion/page-embed.service';

export type CollabEventHandlers = ReturnType<
  CollaborationHandler['getHandlers']
>;

@Injectable()
export class CollaborationHandler {
  private readonly logger = new Logger(CollaborationHandler.name);

  constructor(private readonly pageEmbeds: PageEmbedService) {}

  getHandlers(hocuspocus: Hocuspocus) {
    return {
      alterState: async (documentName: string, payload: { pageId: string }) => {
        // dummy
        // this.logger.log('Processing', documentName, payload);
        // await this.withYdocConnection(hocuspocus, documentName, {}, (doc) => {
        //   const fragment = doc.getXmlFragment('default');
        //});
      },
      updatePageContent: async (
        documentName: string,
        payload: {
          prosemirrorJson: any;
          operation: string;
          user: User;
        },
      ) => {
        const { prosemirrorJson, operation, user } = payload;
        try {
          strictJsonToNode(prosemirrorJson).check();
        } catch {
          throw new BadRequestException({
            code: 'invalid_page_content',
            message: 'Invalid page content',
          });
        }
        this.logger.debug('Updating page content via yjs', documentName);
        await this.withYdocConnection(
          hocuspocus,
          documentName,
          { user },
          (doc) => {
            const fragment = doc.getXmlFragment('default');

            if (operation === 'replace') {
              if (fragment.length > 0) {
                fragment.delete(0, fragment.length);
              }

              const newDoc = TiptapTransformer.toYdoc(
                prosemirrorJson,
                'default',
                tiptapExtensions,
              );
              Y.applyUpdate(doc, Y.encodeStateAsUpdate(newDoc));
            } else {
              const newContent = prosemirrorJson.content || [];
              const yElements = newContent.map(prosemirrorNodeToYElement);
              const position = operation === 'prepend' ? 0 : fragment.length;
              fragment.insert(position, yElements);
            }
          },
        );
      },
      applyAiPageOperation: async (
        documentName: string,
        payload: {
          operation: AiPageOperation;
          baseContentHash: string;
          expectedAfterHash: string;
          user: User;
        },
      ) => {
        const { operation, baseContentHash, expectedAfterHash, user } = payload;
        this.logger.debug('Applying approved AI page operation', documentName);
        return this.withYdocConnection(
          hocuspocus,
          documentName,
          { user },
          (doc) => {
            const current = TiptapTransformer.fromYdoc(doc, 'default');
            const beforeHash = hashProseMirrorJson(current);
            if (beforeHash !== baseContentHash) {
              throw new Error('agent_write_stale');
            }
            const next = applyAiPageOperation(current, operation);
            const nextNode = strictJsonToNode(next as any);
            const afterHash = hashProseMirrorJson(next);
            if (afterHash !== expectedAfterHash) {
              throw new Error('agent_write_recovery_mismatch');
            }
            const fragment = doc.getXmlFragment('default');
            updateYFragment(doc, fragment, nextNode, {
              mapping: new Map(),
              isOMark: new Map(),
            });
            const liveAfterHash = hashProseMirrorJson(
              TiptapTransformer.fromYdoc(doc, 'default'),
            );
            if (liveAfterHash !== expectedAfterHash) {
              throw new Error('agent_write_recovery_mismatch');
            }
            return {
              beforeHash,
              afterHash: liveAfterHash,
            };
          },
        );
      },
      applyPageTemplateMutation: async (
        documentName: string,
        payload: {
          originalContent: unknown;
          nextContent: unknown;
          baseContentHash: string;
          mutationId: string;
          operationLeaseToken: string;
          workspaceId: string;
          systemSyncRevision?: number;
          user: User;
        },
      ) => {
        const {
          originalContent,
          nextContent,
          baseContentHash,
          mutationId,
          operationLeaseToken,
          workspaceId,
          systemSyncRevision,
          user,
        } = payload;
        strictJsonToNode(nextContent as any);
        const mutationAfterHash = hashProseMirrorJson(nextContent as any);
        let mutationApplied = false;
        const graphLease = await this.pageEmbeds.acquireGraphLeaseForContent(
          workspaceId,
          nextContent,
        );
        try {
          return await this.withYdocConnection(
            hocuspocus,
            documentName,
            {
              user,
              pageTemplateMutationId: mutationId,
              pageTemplateOperationLeaseToken: operationLeaseToken,
              pageTemplateSystemSyncRevision: systemSyncRevision,
              pageEmbedGraphLease: graphLease,
            },
            (doc) => {
              const current = TiptapTransformer.fromYdoc(doc, 'default');
              const beforeHash = hashProseMirrorJson(current);
              if (beforeHash !== baseContentHash) {
                throw new ConflictException({
                  code: 'page_embed_stale',
                  message: 'The document changed',
                });
              }
              this.replaceDocumentContent(doc, nextContent);
              mutationApplied = true;
              return {
                beforeHash,
                afterHash: mutationAfterHash,
              };
            },
          );
        } catch (error) {
          if (!mutationApplied) throw error;
          // A failed persistence hook must not leave an unpersisted live node in
          // the shared Yjs document. Restore only while this mutation is still
          // the current state so a concurrent winner can never be overwritten.
          try {
            await this.withYdocConnection(
              hocuspocus,
              documentName,
              { user, pageTemplateRecovery: true },
              (doc) => {
                const current = TiptapTransformer.fromYdoc(doc, 'default');
                if (hashProseMirrorJson(current) !== mutationAfterHash) {
                  return false;
                }
                this.replaceDocumentContent(doc, originalContent);
                return true;
              },
            );
          } catch (recoveryError) {
            this.logger.error(
              `Failed to restore page template mutation ${mutationId}`,
              recoveryError as Error,
            );
          }
          throw error;
        } finally {
          if (graphLease) {
            try {
              await graphLease.release();
            } catch (releaseError) {
              this.logger.error(
                `Failed to release page embed graph lease for ${mutationId}`,
                releaseError as Error,
              );
            }
          }
        }
      },
      getAiPageContentHash: async (
        documentName: string,
        payload: { user: User },
      ) => {
        return this.withYdocConnection(
          hocuspocus,
          documentName,
          { user: payload.user },
          (doc) =>
            hashProseMirrorJson(TiptapTransformer.fromYdoc(doc, 'default')),
        );
      },
      getAiPageContent: async (
        documentName: string,
        payload: { user: User },
      ) => {
        return this.withYdocConnection(
          hocuspocus,
          documentName,
          { user: payload.user },
          (doc) => TiptapTransformer.fromYdoc(doc, 'default'),
        );
      },
    };
  }

  async withYdocConnection<T = void>(
    hocuspocus: Hocuspocus,
    documentName: string,
    context: any = {},
    fn: (doc: Document) => T,
  ): Promise<T> {
    const connection = await hocuspocus.openDirectConnection(
      documentName,
      context,
    );
    let result: T;
    try {
      await connection.transact((doc) => {
        result = fn(doc);
      });
      return result!;
    } finally {
      await connection.disconnect();
    }
  }

  private replaceDocumentContent(doc: Document, content: unknown): void {
    const fragment = doc.getXmlFragment('default');
    if (fragment.length > 0) fragment.delete(0, fragment.length);
    const next = TiptapTransformer.toYdoc(
      content as any,
      'default',
      tiptapExtensions,
    );
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(next));
  }
}
