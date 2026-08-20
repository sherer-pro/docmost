import { Injectable } from '@nestjs/common';
import {
  RagAuthContext,
  RagContentExportService,
} from './rag-content-export.service';

export type { RagAuthContext } from './rag-content-export.service';

type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest]
  ? Rest
  : never;

/**
 * API-key-facing facade. Its public methods accept only a creator-authorized
 * context; the embedded synchronizer injects RagContentExportService directly.
 */
@Injectable()
export class RagService {
  constructor(private readonly content: RagContentExportService) {}

  getScope(scope: RagAuthContext) {
    return this.content.getScope(scope);
  }

  getBlockedPages(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getBlockedPages']>>
  ) {
    return this.content.getBlockedPages(scope, ...args);
  }

  listPages(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['listPages']>>
  ) {
    return this.content.listPages(scope, ...args);
  }

  getPageInfo(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getPageInfo']>>
  ) {
    return this.content.getPageInfo(scope, ...args);
  }

  getUpdates(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getUpdates']>>
  ) {
    return this.content.getUpdates(scope, ...args);
  }

  getDeleted(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getDeleted']>>
  ) {
    return this.content.getDeleted(scope, ...args);
  }

  listDictionaryTerms(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['listDictionaryTerms']>>
  ) {
    return this.content.listDictionaryTerms(scope, ...args);
  }

  getDictionaryTerm(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getDictionaryTerm']>>
  ) {
    return this.content.getDictionaryTerm(scope, ...args);
  }

  getDictionaryUpdates(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getDictionaryUpdates']>>
  ) {
    return this.content.getDictionaryUpdates(scope, ...args);
  }

  getDictionaryDeleted(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getDictionaryDeleted']>>
  ) {
    return this.content.getDictionaryDeleted(scope, ...args);
  }

  getAttachmentUpdates(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getAttachmentUpdates']>>
  ) {
    return this.content.getAttachmentUpdates(scope, ...args);
  }

  getAttachmentDeleted(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getAttachmentDeleted']>>
  ) {
    return this.content.getAttachmentDeleted(scope, ...args);
  }

  getDatabaseInfo(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getDatabaseInfo']>>
  ) {
    return this.content.getDatabaseInfo(scope, ...args);
  }

  getDatabaseRows(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getDatabaseRows']>>
  ) {
    return this.content.getDatabaseRows(scope, ...args);
  }

  getPageAttachments(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getPageAttachments']>>
  ) {
    return this.content.getPageAttachments(scope, ...args);
  }

  getComments(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['getComments']>>
  ) {
    return this.content.getComments(scope, ...args);
  }

  exportPage(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['exportPage']>>
  ) {
    return this.content.exportPage(scope, ...args);
  }

  exportSpace(
    scope: RagAuthContext,
    ...args: Tail<Parameters<RagContentExportService['exportSpace']>>
  ) {
    return this.content.exportSpace(scope, ...args);
  }

  resolveAttachmentForDownload(
    scope: RagAuthContext,
    ...args: Tail<
      Parameters<RagContentExportService['resolveAttachmentForDownload']>
    >
  ) {
    return this.content.resolveAttachmentForDownload(scope, ...args);
  }
}
