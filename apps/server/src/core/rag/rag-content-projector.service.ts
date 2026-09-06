import { Injectable } from '@nestjs/common';
import {
  RAG_CONTENT_POLICY_VERSION,
  type RagContentCapability,
  type RagContentProcessorId,
} from '@docmost/api-contract';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import {
  RagAttachmentTextProjectionInput,
  RagContentProjector,
  RagProjectionResult,
  RagStructuredKnowledgeProjectionInput,
} from './rag-content-projector';

const ATTACHMENT_TEXT_MIME_TYPES = [
  'application/octet-stream',
  'text/markdown',
  'text/plain',
  'text/x-markdown',
];

const CONFIGURABLE_PROCESSOR_IDS = new Set<RagContentProcessorId>([
  'attachment-text-v1',
]);

@Injectable()
export class RagStructuredKnowledgeProjector
  implements RagContentProjector<RagStructuredKnowledgeProjectionInput>
{
  readonly id = 'structured-knowledge-v2' as const;
  readonly capability: RagContentCapability = {
    processorId: this.id,
    state: 'enabled',
    sourceType: 'structured',
    extensions: ['.md'],
    mimeTypes: ['text/markdown'],
  };

  project(input: RagStructuredKnowledgeProjectionInput): RagProjectionResult {
    return {
      projectorId: this.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      parts: [
        {
          partId: 'main',
          fileName: input.fileName,
          mimeType: 'text/markdown',
          content: new TextEncoder().encode(input.markdown),
          locator: {
            pageId: input.pageId,
            ...(input.databaseId ? { databaseId: input.databaseId } : {}),
          },
        },
      ],
    };
  }
}

@Injectable()
export class RagAttachmentTextProjector
  implements RagContentProjector<RagAttachmentTextProjectionInput>
{
  readonly id = 'attachment-text-v1' as const;
  readonly capability: RagContentCapability = {
    processorId: this.id,
    state: 'enabled',
    sourceType: 'attachment',
    extensions: ['.md', '.txt'],
    mimeTypes: ATTACHMENT_TEXT_MIME_TYPES,
  };

  project(input: RagAttachmentTextProjectionInput): RagProjectionResult {
    return {
      projectorId: this.id,
      sourceType: 'attachment',
      sourceId: input.sourceId,
      parts: [
        {
          partId: 'main',
          fileName: input.fileName,
          mimeType: input.mimeType || 'text/plain',
          content: input.content,
          locator: {
            pageId: input.pageId,
            attachmentId: input.sourceId,
          },
        },
      ],
    };
  }
}

@Injectable()
export class RagContentProjectorService {
  readonly policyVersion = RAG_CONTENT_POLICY_VERSION;
  private readonly enabledProcessorIds: ReadonlySet<RagContentProcessorId>;

  constructor(
    environment: EnvironmentService,
    private readonly structuredKnowledge: RagStructuredKnowledgeProjector,
    private readonly attachmentText: RagAttachmentTextProjector,
  ) {
    this.enabledProcessorIds = this.parseEnabledProcessorIds(
      environment.getRagContentProcessorsEnabled(),
    );
  }

  getCapabilities(): RagContentCapability[] {
    const attachmentText = {
      ...this.attachmentText.capability,
      state: this.enabledProcessorIds.has(this.attachmentText.id)
        ? ('enabled' as const)
        : ('disabled' as const),
    };
    return [
      this.structuredKnowledge.capability,
      attachmentText,
      ...(
        [
          'pdf-text-v1',
          'docx-text-v1',
          'image-ocr-v1',
          'image-vision-v1',
          'audio-transcript-v1',
        ] as const
      ).map((processorId) => ({
        processorId,
        state: 'disabled' as const,
        sourceType: 'attachment' as const,
        extensions: [],
        mimeTypes: [],
      })),
    ];
  }

  isAttachmentSupported(input: {
    fileName: string;
    fileExt: string;
    mimeType: string | null;
  }): boolean {
    if (!this.enabledProcessorIds.has(this.attachmentText.id)) return false;
    const extension = normalizeExtension(input.fileExt || input.fileName);
    const mimeType = input.mimeType?.trim().toLowerCase();
    return (
      this.attachmentText.capability.extensions.includes(extension) &&
      Boolean(
        mimeType && this.attachmentText.capability.mimeTypes.includes(mimeType),
      )
    );
  }

  projectAttachmentText(
    input: RagAttachmentTextProjectionInput,
  ): RagProjectionResult {
    if (!this.isAttachmentSupported(input)) {
      throw new Error('Attachment content processor is not enabled');
    }
    return this.attachmentText.project(input);
  }

  projectStructuredKnowledge(
    input: RagStructuredKnowledgeProjectionInput,
  ): RagProjectionResult {
    return this.structuredKnowledge.project(input);
  }

  fingerprintInput() {
    return {
      contentPolicyVersion: this.policyVersion,
      contentCapabilities: this.getCapabilities(),
    };
  }

  private parseEnabledProcessorIds(
    rawValue: string,
  ): ReadonlySet<RagContentProcessorId> {
    const ids = rawValue
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    for (const id of ids) {
      if (!CONFIGURABLE_PROCESSOR_IDS.has(id as RagContentProcessorId)) {
        throw new Error(`Unsupported RAG content processor: ${id}`);
      }
    }
    return new Set(ids as RagContentProcessorId[]);
  }
}

function normalizeExtension(value: string): string {
  const normalized = value.trim().toLowerCase();
  const suffix = normalized.includes('.')
    ? normalized.slice(normalized.lastIndexOf('.'))
    : normalized;
  return suffix ? (suffix.startsWith('.') ? suffix : `.${suffix}`) : '';
}
