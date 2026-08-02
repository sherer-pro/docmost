import { Injectable, Logger } from '@nestjs/common';
import { Hocuspocus, Document } from '@hocuspocus/server';
import { TiptapTransformer } from '@hocuspocus/transformer';
import {
  prosemirrorNodeToYElement,
  tiptapExtensions,
} from './collaboration.util';
import * as Y from 'yjs';
import { User } from '@docmost/db/types/entity.types';
import {
  AiPageOperation,
  applyAiPageOperation,
  hashProseMirrorJson,
} from '../common/helpers/prosemirror/ai-page-operation';
import { strictJsonToNode } from './collaboration.util';

export type CollabEventHandlers = ReturnType<
  CollaborationHandler['getHandlers']
>;

@Injectable()
export class CollaborationHandler {
  private readonly logger = new Logger(CollaborationHandler.name);

  constructor() {}

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
              const position =
                operation === 'prepend' ? 0 : fragment.length;
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
            strictJsonToNode(next as any);
            const afterHash = hashProseMirrorJson(next);
            if (afterHash !== expectedAfterHash) {
              throw new Error('agent_write_recovery_mismatch');
            }
            const fragment = doc.getXmlFragment('default');
            if (fragment.length > 0) {
              fragment.delete(0, fragment.length);
            }
            const newDoc = TiptapTransformer.toYdoc(
              next,
              'default',
              tiptapExtensions,
            );
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(newDoc));
            return {
              beforeHash,
              afterHash,
            };
          },
        );
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
            hashProseMirrorJson(
              TiptapTransformer.fromYdoc(doc, 'default'),
            ),
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
}
