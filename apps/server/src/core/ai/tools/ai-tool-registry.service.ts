import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import type { JSONContent } from '@tiptap/core';
import {
  prosemirrorNodeToYJson,
  strictJsonToNode,
} from '../../../collaboration/collaboration.util';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { resolveComputedDatabaseRows } from '@docmost/db/utils/database-resolved-cells';
import type {
  AiToolExposure,
  AiToolWriteClass,
  AiToolExecutionContext,
  AiToolExecutionResult,
} from './ai-tool-execution.types';
import {
  AI_BUILTIN_TOOL_CATEGORIES,
  AI_BUILTIN_TOOL_CAPABILITIES,
  AiBuiltinToolAnnotations,
  AiBuiltinToolApprovalMode,
  AiBuiltinToolCapability,
  AiBuiltinToolCategory,
  AiBuiltinToolTargetScope,
} from '@docmost/api-contract';
import { PageAccessService } from '../../page-access/page-access.service';
import { SearchService } from '../../search/search.service';
import { AiContentPolicyService } from '../../ai-content-policy/ai-content-policy.service';
import { PageService } from '../../page/services/page.service';
import {
  COLLABORATION_DOCUMENT_PORT,
  CollaborationDocumentPort,
} from '../../../collaboration/collaboration-document.port';
import {
  AiPageOperation,
  ProseMirrorJson,
  applyAiPageOperation,
  assertSafeAiPageOperation,
  buildAiApprovalPreview,
  getAiPageNode,
  getAiPageNodePath,
  getAiPageOutline,
  getProseMirrorText,
  hashProseMirrorJson,
  prepareAiPageOperation,
} from '../../../common/helpers/prosemirror/ai-page-operation';
import { AiCitationCandidate } from '../ai.types';
import { AI_MCP_TOOL_NAME_PREFIX } from '../mcp/ai-mcp.constants';
import { ShareService } from '../../share/share.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { diffProseMirrorDocuments } from '@docmost/editor-ext/server';
import { jsonToNode } from '../../../collaboration/collaboration.util';
import { PageTemplatePolicyService } from '../../page/transclusion/page-template-policy.service';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { SpaceRole } from '../../../common/helpers/types/permission';
import { KnowledgeProjectionService } from '../../rag/knowledge-projection.service';
import {
  AiDatabaseService,
  AI_DATABASE_CALCULATIONS,
} from '../services/ai-database.service';
import {
  AI_READ_CURSOR_SCHEMA,
  AI_READ_RESULT_BYTES,
  hashReadVersion,
  paginateReadItems,
  paginateReadText,
  readResultFits,
} from './ai-tool-read-pagination';
import { AiAttachmentReadService } from './ai-attachment-read.service';
import {
  AI_DATABASE_SELECTION_GUIDANCE,
  AI_DATABASE_VIEW_INPUT_SCHEMA,
} from './ai-database-view-input-schema';

// Model steps and tool calls are budgeted per approval segment: an approved,
// rejected, or expired write proposal starts a new segment. The run-level
// ceilings still bound the whole attempt.
export const AI_AGENT_MAX_MODEL_STEPS = 8;
export const AI_AGENT_MAX_TOOL_CALLS = 16;
export const AI_AGENT_MAX_RUN_MODEL_STEPS = 32;
export const AI_AGENT_MAX_RUN_TOOL_CALLS = 64;
export const AI_TOOL_RESULT_MAX_BYTES = AI_READ_RESULT_BYTES;
export const AI_TOOL_RESULTS_TOTAL_MAX_BYTES = 128 * 1024;

export class AiToolResultLimitError extends BadRequestException {
  constructor() {
    super({
      code: 'MCP_RESULT_TOO_LARGE',
      message: 'AI tool result exceeds its configured limit',
    });
    this.name = 'AiToolResultLimitError';
  }
}
export const AI_WRITE_PROPOSAL_TTL_MS = 60 * 60 * 1000;

const AI_TOOL_CURSOR_VERSION = 1;
const AI_TOOL_CURSOR_MAX_LENGTH = 2048;

type AiToolKeysetCursor = {
  version: typeof AI_TOOL_CURSOR_VERSION;
  tool: string;
  resourceId: string;
  sortAt: string;
  id: string;
};

export function fitAiToolItems<T>(
  items: T[],
  maxBytes = AI_TOOL_RESULT_MAX_BYTES,
): { items: T[]; truncated: boolean } {
  const content = { items, truncated: false };
  if (Buffer.byteLength(JSON.stringify(content), 'utf8') <= maxBytes) {
    return content;
  }

  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = { items: items.slice(0, middle), truncated: true };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return { items: items.slice(0, low), truncated: true };
}

export type {
  AiToolExposure,
  AiToolWriteClass,
  AiToolExecutionContext,
  AiToolWriteProposal,
  AiToolExecutionResult,
} from './ai-tool-execution.types';

export type AiCallableToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  writeClass: AiToolWriteClass;
  exposures: AiToolExposure[];
};

export type AiToolDefinition = AiCallableToolDefinition & {
  capability: AiBuiltinToolCapability;
  category: AiBuiltinToolCategory;
  targetScope: AiBuiltinToolTargetScope;
  approvalMode: AiBuiltinToolApprovalMode;
  maxResultBytes: number;
  annotations: AiBuiltinToolAnnotations;
};

type InternalAiToolDefinition = AiToolDefinition & {
  execute: (
    args: Record<string, unknown>,
    context: AiToolExecutionContext,
  ) => Promise<AiToolExecutionResult>;
};

const PAGE_ID_SCHEMA = {
  type: 'string',
  format: 'uuid',
  description: 'A page ID from this space.',
};

const CURRENT_PAGE_ID_SCHEMA = {
  type: 'string',
  format: 'uuid',
  description:
    'Optional. Writes always target the current page, so omit this field unless you repeat the exact current page ID given in the system message.',
};

const NODE_ID_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  description:
    'A node ID from getOutline. Use the item "id" when it is present, otherwise its "#index" form such as "#3".',
};

const OUTLINE_CONTENT_HASH_SCHEMA = {
  type: 'string',
  pattern: '^[a-f0-9]{64}$',
  description:
    'Required when a node reference uses #index. Pass the contentHash returned by getOutline.',
};

const READ_TOOL_POLICY = {
  approvalMode: 'none',
  maxResultBytes: AI_TOOL_RESULT_MAX_BYTES,
  annotations: {
    idempotent: true,
    destructive: false,
    openWorld: false,
  },
} as const;

const WRITE_TOOL_POLICY = {
  approvalMode: 'current_page_hash',
  maxResultBytes: AI_TOOL_RESULT_MAX_BYTES,
  annotations: {
    idempotent: true,
    destructive: false,
    openWorld: false,
  },
} as const;

@Injectable()
export class AiToolRegistryService {
  private readonly logger = new Logger(AiToolRegistryService.name);
  private readonly tools: InternalAiToolDefinition[];

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageAccess: PageAccessService,
    private readonly search: SearchService,
    private readonly contentPolicy: AiContentPolicyService,
    private readonly pages: PageService,
    @Inject(COLLABORATION_DOCUMENT_PORT)
    private readonly collaboration: CollaborationDocumentPort,
    private readonly shareService: ShareService,
    private readonly environment: EnvironmentService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageTemplatePolicy: PageTemplatePolicyService,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    @Optional()
    private readonly knowledgeProjection: KnowledgeProjectionService = new KnowledgeProjectionService(
      db,
    ),
    @Optional() private readonly databases?: AiDatabaseService,
    @Optional() private readonly attachmentReads?: AiAttachmentReadService,
  ) {
    this.tools = this.createTools();
    // The mcp__ prefix is reserved for outbound external MCP tools. Reusing it
    // for a built-in tool would let an external definition shadow a Docmost one
    // in the merged agent tool list.
    const reserved = this.tools.find((tool) =>
      tool.name.startsWith(AI_MCP_TOOL_NAME_PREFIX),
    );
    if (reserved) {
      throw new Error(
        `Built-in AI tool "${reserved.name}" must not use the reserved ${AI_MCP_TOOL_NAME_PREFIX} prefix`,
      );
    }
    const names = new Set<string>();
    const capabilities = new Set<string>();
    for (const tool of this.tools) {
      const exposures = new Set(tool.exposures);
      if (names.has(tool.name)) {
        throw new Error(`Duplicate built-in AI tool name: ${tool.name}`);
      }
      if (capabilities.has(tool.capability)) {
        throw new Error(
          `Duplicate built-in AI tool capability: ${tool.capability}`,
        );
      }
      if (
        typeof tool.name !== 'string' ||
        tool.name.trim().length === 0 ||
        !AI_BUILTIN_TOOL_CAPABILITIES.includes(tool.capability) ||
        !AI_BUILTIN_TOOL_CATEGORIES.includes(tool.category) ||
        ![
          'workspace',
          'current_space',
          'readable_page',
          'current_page',
          'current_database',
        ].includes(tool.targetScope) ||
        !['none', 'current_page_hash', 'database_cell_revisions'].includes(
          tool.approvalMode,
        ) ||
        !['read_only', 'write'].includes(tool.writeClass) ||
        tool.exposures.length === 0 ||
        exposures.size !== tool.exposures.length ||
        tool.exposures.some(
          (exposure) => exposure !== 'agent' && exposure !== 'mcp',
        ) ||
        typeof tool.annotations.idempotent !== 'boolean' ||
        typeof tool.annotations.destructive !== 'boolean' ||
        typeof tool.annotations.openWorld !== 'boolean'
      ) {
        throw new Error(
          `Invalid policy metadata for built-in AI tool: ${tool.name}`,
        );
      }
      if (
        !Number.isInteger(tool.maxResultBytes) ||
        tool.maxResultBytes <= 0 ||
        tool.maxResultBytes > AI_TOOL_RESULT_MAX_BYTES
      ) {
        throw new Error(
          `Invalid result limit for built-in AI tool: ${tool.name}`,
        );
      }
      if (
        (tool.writeClass === 'read_only' && tool.approvalMode !== 'none') ||
        (tool.writeClass === 'write' &&
          !(
            (tool.approvalMode === 'current_page_hash' &&
              tool.targetScope === 'current_page') ||
            (tool.approvalMode === 'database_cell_revisions' &&
              tool.targetScope === 'current_database')
          )) ||
        (tool.writeClass === 'write' &&
          (tool.exposures.length !== 1 || tool.exposures[0] !== 'agent')) ||
        (tool.exposures.includes('mcp') && tool.writeClass !== 'read_only')
      ) {
        throw new Error(
          `Invalid policy metadata for built-in AI tool: ${tool.name}`,
        );
      }
      names.add(tool.name);
      capabilities.add(tool.capability);
    }
  }

  list(exposure: AiToolExposure): AiToolDefinition[] {
    return this.tools
      .filter((tool) => tool.exposures.includes(exposure))
      .map(({ execute: _execute, ...tool }) => tool);
  }

  get(name: string, exposure: AiToolExposure): AiToolDefinition | undefined {
    const tool = this.tools.find(
      (candidate) =>
        candidate.name === name && candidate.exposures.includes(exposure),
    );
    if (!tool) return undefined;
    const { execute: _execute, ...definition } = tool;
    return definition;
  }

  async execute(
    name: string,
    args: unknown,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const tool = this.tools.find(
      (candidate) =>
        candidate.name === name && candidate.exposures.includes(context.source),
    );
    if (!tool) {
      throw new BadRequestException('Unknown or unavailable AI tool');
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new BadRequestException('AI tool arguments must be an object');
    }

    const result = await tool.execute(args as Record<string, unknown>, context);
    const size = Buffer.byteLength(JSON.stringify(result.content), 'utf8');
    if (size > tool.maxResultBytes) {
      throw new AiToolResultLimitError();
    }
    return result;
  }

  private createTools(): InternalAiToolDefinition[] {
    return [
      ...this.createDatabaseTools(),
      ...this.createAdditionalReadTools(),
      {
        name: 'search',
        description:
          'Search readable pages, database rows, and dictionary terms in the current space. Returns compact snippets and source IDs.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 512 },
            limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'search.query',
        category: 'search',
        targetScope: 'current_space',
        ...READ_TOOL_POLICY,
        execute: (args, context) => this.searchSpace(args, context),
      },
      {
        name: 'getTree',
        description:
          'List readable page metadata in stable, version-bound pages. Continue with nextCursor until null.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: AI_READ_CURSOR_SCHEMA,
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.tree.read',
        category: 'page_read',
        targetScope: 'current_space',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.getTree(
            context,
            this.optionalString(args, 'cursor', 2048),
            this.optionalInteger(args, 'limit', 100, 1, 100),
          ),
      },
      {
        name: 'getPageContext',
        description:
          'Get compact metadata, visible breadcrumbs, and direct readable children for a page.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: { pageId: PAGE_ID_SCHEMA, cursor: AI_READ_CURSOR_SCHEMA },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.context.read',
        category: 'page_read',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.getPageContext(
            this.requireString(args, 'pageId', false, 64),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'getPage',
        description:
          'Read a complete page. Large documents return text fragments and nextCursor instead of oversized JSON; continue until nextCursor is null.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: { pageId: PAGE_ID_SCHEMA, cursor: AI_READ_CURSOR_SCHEMA },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.content.read',
        category: 'page_read',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.getPage(
            this.requireString(args, 'pageId', false, 64),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'getOutline',
        description:
          'Get stable node IDs, fallback #indexes, nesting levels, types, and compact text for a page.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: { pageId: PAGE_ID_SCHEMA, cursor: AI_READ_CURSOR_SCHEMA },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.outline.read',
        category: 'page_read',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.getOutline(
            this.requireString(args, 'pageId', false, 64),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'getNode',
        description:
          'Read a ProseMirror node by stable ID or #index from getOutline. Large nodes return nodeJsonChunk; concatenate all chunks and parse JSON.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId', 'nodeId'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            nodeId: { type: 'string', minLength: 1, maxLength: 128 },
            cursor: AI_READ_CURSOR_SCHEMA,
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.node.read',
        category: 'page_read',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.getNode(
            this.requireString(args, 'pageId', false, 64),
            this.requireString(args, 'nodeId', false, 128),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'searchInPage',
        description:
          'Find exact case-insensitive text occurrences in one readable page.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId', 'query'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            query: { type: 'string', minLength: 1, maxLength: 512 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.text.search',
        category: 'page_read',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.searchInPage(
            this.requireString(args, 'pageId', false, 64),
            this.requireString(args, 'query', false, 512),
            this.optionalInteger(args, 'limit', 20, 1, 50),
            context,
          ),
      },
      {
        name: 'getWorkspaceContext',
        description:
          'Get safe metadata about the current workspace and the current user role. Raw workspace settings are never returned.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'workspace.context.read',
        category: 'context',
        targetScope: 'workspace',
        ...READ_TOOL_POLICY,
        maxResultBytes: 4 * 1024,
        execute: (_args, context) => this.getWorkspaceContext(context),
      },
      {
        name: 'getSpaceContext',
        description:
          'Get safe metadata and effective capability flags for the current space.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'space.context.read',
        category: 'context',
        targetScope: 'current_space',
        ...READ_TOOL_POLICY,
        maxResultBytes: 8 * 1024,
        execute: (_args, context) => this.getSpaceContext(context),
      },
      {
        name: 'getDatabaseContext',
        description: `Get curated metadata, schema properties, and compact view metadata for one readable database. Schema properties and view names do not define the active selection. ${AI_DATABASE_SELECTION_GUIDANCE}`,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['databaseId'],
          properties: {
            databaseId: { type: 'string', format: 'uuid' },
            cursor: AI_READ_CURSOR_SCHEMA,
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'database.context.read',
        category: 'database',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        maxResultBytes: 24 * 1024,
        execute: (args, context) =>
          this.getDatabaseContext(
            this.requireString(args, 'databaseId', false, 64),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'listDatabaseRows',
        description:
          'List readable rows and normalized cells for one readable database. Results are cursor-paginated.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['databaseId'],
          properties: {
            databaseId: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            cursor: { type: 'string', maxLength: 256 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'database.rows.read',
        category: 'database',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.listDatabaseRows(
            this.requireString(args, 'databaseId', false, 64),
            this.optionalInteger(args, 'limit', 20, 1, 50),
            this.optionalString(args, 'cursor', 256),
            context,
          ),
      },
      {
        name: 'getDatabaseRowContext',
        description:
          'Get the database schema and normalized cells for one readable database row page.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: { pageId: PAGE_ID_SCHEMA, cursor: AI_READ_CURSOR_SCHEMA },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'database.row_context.read',
        category: 'database',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        maxResultBytes: 24 * 1024,
        execute: (args, context) =>
          this.getDatabaseRowContext(
            this.requireString(args, 'pageId', false, 64),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'getTable',
        description:
          'Read one table as compact text and cell-ID matrices. tableRef is a #index from getOutline or an ID inside the table.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId', 'tableRef'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            cursor: AI_READ_CURSOR_SCHEMA,
            tableRef: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.table.read',
        category: 'page_structure',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.getTable(
            this.requireString(args, 'pageId', false, 64),
            this.requireString(args, 'tableRef', false, 128),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'listComments',
        description:
          'List comments on one readable page with safe actor metadata and compact content.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            cursor: { type: 'string', maxLength: 256 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.comments.read',
        category: 'collaboration',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        maxResultBytes: 24 * 1024,
        execute: (args, context) =>
          this.listComments(
            this.requireString(args, 'pageId', false, 64),
            this.optionalInteger(args, 'limit', 20, 1, 50),
            this.optionalString(args, 'cursor', 256),
            context,
          ),
      },
      {
        name: 'listPageHistory',
        description:
          'List compact saved-version metadata for one readable page. Version content is not returned.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            cursor: { type: 'string', maxLength: 256 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.history.list',
        category: 'history',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        maxResultBytes: 16 * 1024,
        execute: (args, context) =>
          this.listPageHistory(
            this.requireString(args, 'pageId', false, 64),
            this.optionalInteger(args, 'limit', 20, 1, 50),
            this.optionalString(args, 'cursor', 256),
            context,
          ),
      },
      {
        name: 'diffPageVersion',
        description:
          'Compare one saved page version with the current live Yjs document. Returns a bounded semantic diff, not either full document.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId', 'historyId'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            historyId: { type: 'string', format: 'uuid' },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.history.diff',
        category: 'history',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.diffPageVersion(
            this.requireString(args, 'pageId', false, 64),
            this.requireString(args, 'historyId', false, 64),
            context,
          ),
      },
      {
        name: 'listTransclusionReferences',
        description:
          'List readable same-space pages that reference one synced block.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['sourcePageId', 'transclusionId'],
          properties: {
            sourcePageId: PAGE_ID_SCHEMA,
            transclusionId: { type: 'string', minLength: 1, maxLength: 128 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            cursor: { type: 'string', maxLength: 256 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.transclusion_references.read',
        category: 'collaboration',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        maxResultBytes: 16 * 1024,
        execute: (args, context) =>
          this.listTransclusionReferences(
            this.requireString(args, 'sourcePageId', false, 64),
            this.requireString(args, 'transclusionId', false, 128),
            this.optionalInteger(args, 'limit', 20, 1, 50),
            this.optionalString(args, 'cursor', 256),
            context,
          ),
      },
      {
        name: 'listPageAttachments',
        description:
          'List safe attachment metadata for one readable page. File paths, bytes, extracted text, and download tokens are never returned.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            cursor: { type: 'string', maxLength: 256 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.attachments.metadata.read',
        category: 'attachments',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        maxResultBytes: 16 * 1024,
        execute: (args, context) =>
          this.listPageAttachments(
            this.requireString(args, 'pageId', false, 64),
            this.optionalInteger(args, 'limit', 50, 1, 100),
            this.optionalString(args, 'cursor', 256),
            context,
          ),
      },
      {
        name: 'getPublicShareInfo',
        description:
          'Get the effective direct or inherited public-share state for one readable page.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: { pageId: PAGE_ID_SCHEMA },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.public_share.read',
        category: 'sharing',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        maxResultBytes: 8 * 1024,
        execute: (args, context) =>
          this.getPublicShareInfo(
            this.requireString(args, 'pageId', false, 64),
            context,
          ),
      },
      {
        name: 'listPageTemplates',
        description:
          'List readable regular and synchronized page templates in the current space without page content.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.templates.list',
        category: 'page_read',
        targetScope: 'current_space',
        ...READ_TOOL_POLICY,
        maxResultBytes: 16 * 1024,
        execute: (args, context) =>
          this.listPageTemplates(
            this.optionalString(args, 'query', 200),
            this.optionalInteger(args, 'limit', 20, 1, 50),
            context,
          ),
      },
      {
        name: 'getPageTemplateMetadata',
        description:
          'Read safe metadata for one regular or synchronized template in the current space.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: { pageId: PAGE_ID_SCHEMA },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.template.metadata.read',
        category: 'page_read',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        maxResultBytes: 8 * 1024,
        execute: (args, context) =>
          this.getPageTemplateMetadata(
            this.requireString(args, 'pageId', false, 64),
            context,
          ),
      },
      {
        name: 'listPageTemplateUsages',
        description:
          'List readable pages created from one template. Detached pages are excluded and only consumers in the current scoped space are counted.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.template.usages.read',
        category: 'collaboration',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        maxResultBytes: 16 * 1024,
        execute: (args, context) =>
          this.listPageTemplateUsages(
            this.requireString(args, 'pageId', false, 64),
            this.optionalInteger(args, 'limit', 20, 1, 50),
            context,
          ),
      },
      {
        name: 'editPageText',
        description:
          'Propose one exact text replacement in a node on the current page. oldText must sit inside one unstyled text run, so use patchNode when the fragment crosses bold, italic, or link boundaries. Requires user approval.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['nodeId', 'oldText', 'newText'],
          properties: {
            pageId: CURRENT_PAGE_ID_SCHEMA,
            nodeId: NODE_ID_SCHEMA,
            outlineContentHash: OUTLINE_CONTENT_HASH_SCHEMA,
            oldText: { type: 'string', minLength: 1, maxLength: 16384 },
            newText: { type: 'string', maxLength: 16384 },
          },
        },
        writeClass: 'write',
        exposures: ['agent'],
        capability: 'page.text.propose',
        category: 'page_write',
        targetScope: 'current_page',
        ...WRITE_TOOL_POLICY,
        execute: (args, context) =>
          this.proposeWrite(
            {
              kind: 'editPageText',
              nodeId: this.requireString(args, 'nodeId', false, 128),
              oldText: this.requireString(args, 'oldText', false, 16 * 1024),
              newText: this.requireString(args, 'newText', true, 16 * 1024),
            },
            this.resolveWritePageId(args, context),
            context,
            this.optionalString(args, 'outlineContentHash', 64),
          ),
      },
      {
        name: 'patchNode',
        description:
          'Propose replacing one node on the current page with safe rich text/block JSON. Requires user approval.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['nodeId', 'node'],
          properties: {
            pageId: CURRENT_PAGE_ID_SCHEMA,
            nodeId: NODE_ID_SCHEMA,
            outlineContentHash: OUTLINE_CONTENT_HASH_SCHEMA,
            node: { type: 'object' },
          },
        },
        writeClass: 'write',
        exposures: ['agent'],
        capability: 'page.node.patch.propose',
        category: 'page_write',
        targetScope: 'current_page',
        ...WRITE_TOOL_POLICY,
        execute: (args, context) =>
          this.proposeWrite(
            {
              kind: 'patchNode',
              nodeId: this.requireString(args, 'nodeId', false, 128),
              node: this.requireObject(args, 'node') as ProseMirrorJson,
            },
            this.resolveWritePageId(args, context),
            context,
            this.optionalString(args, 'outlineContentHash', 64),
          ),
      },
      {
        name: 'insertNode',
        description:
          'Propose inserting one safe rich text/block node before or after a node on the current page. Requires user approval.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['anchorNodeId', 'position', 'node'],
          properties: {
            pageId: CURRENT_PAGE_ID_SCHEMA,
            anchorNodeId: NODE_ID_SCHEMA,
            outlineContentHash: OUTLINE_CONTENT_HASH_SCHEMA,
            position: { type: 'string', enum: ['before', 'after'] },
            node: { type: 'object' },
          },
        },
        writeClass: 'write',
        exposures: ['agent'],
        capability: 'page.node.insert.propose',
        category: 'page_write',
        targetScope: 'current_page',
        ...WRITE_TOOL_POLICY,
        execute: (args, context) =>
          this.proposeWrite(
            {
              kind: 'insertNode',
              anchorNodeId: this.requireString(
                args,
                'anchorNodeId',
                false,
                128,
              ),
              position: this.requireEnum(args, 'position', ['before', 'after']),
              node: this.requireObject(args, 'node') as ProseMirrorJson,
            },
            this.resolveWritePageId(args, context),
            context,
            this.optionalString(args, 'outlineContentHash', 64),
          ),
      },
      {
        name: 'deleteNode',
        description:
          'Propose deleting one node on the current page. Requires user approval.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['nodeId'],
          properties: {
            pageId: CURRENT_PAGE_ID_SCHEMA,
            nodeId: NODE_ID_SCHEMA,
            outlineContentHash: OUTLINE_CONTENT_HASH_SCHEMA,
          },
        },
        writeClass: 'write',
        exposures: ['agent'],
        capability: 'page.node.delete.propose',
        category: 'page_write',
        targetScope: 'current_page',
        ...WRITE_TOOL_POLICY,
        annotations: {
          ...WRITE_TOOL_POLICY.annotations,
          destructive: true,
        },
        execute: (args, context) =>
          this.proposeWrite(
            {
              kind: 'deleteNode',
              nodeId: this.requireString(args, 'nodeId', false, 128),
            },
            this.resolveWritePageId(args, context),
            context,
            this.optionalString(args, 'outlineContentHash', 64),
          ),
      },
    ];
  }

  private createAdditionalReadTools(): InternalAiToolDefinition[] {
    const specs: Array<{
      name: string;
      capability: AiBuiltinToolCapability;
      category: AiBuiltinToolCategory;
      description: string;
      required: string[];
      properties: Record<string, unknown>;
      execute: InternalAiToolDefinition['execute'];
    }> = [
      {
        name: 'getDatabaseCellContent',
        capability: 'database.cell_content.read',
        category: 'database',
        description:
          'Read the complete serialized value of one database cell in version-bound JSON chunks.',
        required: ['pageId', 'propertyId'],
        properties: { pageId: PAGE_ID_SCHEMA, propertyId: PAGE_ID_SCHEMA },
        execute: (args, context) =>
          this.getDatabaseCellContent(
            this.requireString(args, 'pageId', false, 64),
            this.requireString(args, 'propertyId', false, 64),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'getComment',
        capability: 'page.comment.read',
        category: 'collaboration',
        description:
          'Read one active comment, its thread/resolution metadata and complete text in version-bound chunks.',
        required: ['pageId', 'commentId'],
        properties: { pageId: PAGE_ID_SCHEMA, commentId: PAGE_ID_SCHEMA },
        execute: (args, context) =>
          this.getComment(
            this.requireString(args, 'pageId', false, 64),
            this.requireString(args, 'commentId', false, 64),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'getPageVersion',
        capability: 'page.history.content.read',
        category: 'history',
        description:
          'Read the complete text of one saved page version, under current page permissions.',
        required: ['pageId', 'historyId'],
        properties: { pageId: PAGE_ID_SCHEMA, historyId: PAGE_ID_SCHEMA },
        execute: (args, context) =>
          this.getPageVersion(
            this.requireString(args, 'pageId', false, 64),
            this.requireString(args, 'historyId', false, 64),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
      {
        name: 'getAttachmentText',
        capability: 'page.attachments.text.read',
        category: 'attachments',
        description:
          'Read already-extracted PDF/DOCX/TXT/MD attachment text and processing status. Does not start extraction.',
        required: ['attachmentId'],
        properties: { attachmentId: PAGE_ID_SCHEMA },
        execute: (args, context) => {
          if (!this.attachmentReads)
            throw new ServiceUnavailableException(
              'Attachment reads are unavailable',
            );
          return this.attachmentReads.text(
            this.requireString(args, 'attachmentId', false, 64),
            this.optionalString(args, 'cursor', 2048),
            context,
          );
        },
      },
      {
        name: 'getAttachmentFileChunk',
        capability: 'page.attachments.file.read',
        category: 'attachments',
        description:
          'Read original attachment bytes as base64 chunks up to 16 KiB. Reassemble in offset order; restart on a changed source.',
        required: ['attachmentId'],
        properties: { attachmentId: PAGE_ID_SCHEMA },
        execute: (args, context) => {
          if (!this.attachmentReads)
            throw new ServiceUnavailableException(
              'Attachment reads are unavailable',
            );
          return this.attachmentReads.file(
            this.requireString(args, 'attachmentId', false, 64),
            this.optionalString(args, 'cursor', 2048),
            context,
          );
        },
      },
      {
        name: 'getPageMetadata',
        capability: 'page.metadata.read',
        category: 'page_read',
        description:
          'Read complete safe document metadata as version-bound JSON chunks, including labels, actors and enabled document fields.',
        required: ['pageId'],
        properties: { pageId: PAGE_ID_SCHEMA },
        execute: (args, context) =>
          this.getPageMetadata(
            this.requireString(args, 'pageId', false, 64),
            context,
            this.optionalString(args, 'cursor', 2048),
          ),
      },
    ];
    return specs.map(({ required, properties, ...spec }) => ({
      ...spec,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required,
        properties: { ...properties, cursor: AI_READ_CURSOR_SCHEMA },
      },
      writeClass: 'read_only',
      exposures: ['mcp'],
      targetScope: 'readable_page',
      ...READ_TOOL_POLICY,
    }));
  }

  private createDatabaseTools(): InternalAiToolDefinition[] {
    const databaseId = { type: 'string', format: 'uuid' };
    const tools: InternalAiToolDefinition[] = [false, true].map((summary) => ({
      name: summary ? 'summarizeDatabaseView' : 'queryDatabaseView',
      description: summary
        ? `Compute counts and calculations on the complete filtered accessible AI-allowed database selection. Use this tool for how many, totals and date counts; read count as the number of matching rows. Omit viewState when the requested selection matches the frozen current filters and selected rows. For different requested business criteria, including dates or all statuses, supply the corresponding viewState.filter while preserving other current conditions. Get exact property IDs and select options from getDatabaseContext. For calculation overrides prefer calculations: [{propertyId, operation}]. This array replaces only calculations, preserving filters and sorting. Never sum a context snapshot or one page of rows. ${AI_DATABASE_SELECTION_GUIDANCE}`
        : `Query typed database cells for records and their revisions. Use summarizeDatabaseView for counts and totals. Omit viewState to use the frozen current view and selected rows. For different requested business criteria, supply viewState.filter while preserving other current conditions. Get exact property IDs and select options from getDatabaseContext. For calculation overrides prefer calculations: [{propertyId, operation}]. Results are paginated; hasMore means the selection is incomplete. ${AI_DATABASE_SELECTION_GUIDANCE}`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['databaseId'],
        properties: {
          databaseId,
          calculations: {
            type: 'array',
            maxItems: 20,
            description:
              'Optional calculation overrides. Replaces viewState.calculations. Empty array clears calculations. Preserve exact IDs without embedded quotes.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['propertyId', 'operation'],
              properties: {
                propertyId: { type: 'string', format: 'uuid' },
                operation: {
                  type: 'string',
                  enum: [...AI_DATABASE_CALCULATIONS],
                },
              },
            },
          },
          viewState: AI_DATABASE_VIEW_INPUT_SCHEMA,
          ...(summary
            ? {}
            : {
                limit: { type: 'integer', minimum: 1, maximum: 50 },
                cursor: { type: 'string', maxLength: 4096 },
              }),
        },
      },
      writeClass: 'read_only',
      exposures: ['agent', 'mcp'],
      capability: summary ? 'database.summary.read' : 'database.view.query',
      category: 'database',
      targetScope: 'readable_page',
      ...READ_TOOL_POLICY,
      execute: async (args, context) => {
        if (!this.databases)
          throw new ServiceUnavailableException('Database tools unavailable');
        const { dependencyPageIds, ...content } = await this.databases.read(
          args,
          context,
          summary,
        );
        const database = await this.getReadableDatabase(
          String(args.databaseId),
          context,
        );
        return {
          content,
          dependencyPageIds,
          citations: await this.pageRootCitations(
            [{ pageId: database.pageId, type: 'page' }],
            context,
          ),
        };
      },
    }));
    tools.push({
      name: 'proposeDatabaseCells',
      description:
        'Propose typed changes to existing cells of the explicitly selected current database. Read queryDatabaseView first for cell revisions. Never creates rows or properties. The initiating user must approve the complete preview.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['databaseId', 'rows'],
        properties: {
          databaseId,
          rows: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['pageId', 'cells'],
              properties: {
                pageId: databaseId,
                cells: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 100,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['propertyId', 'value', 'expectedRevision'],
                    properties: {
                      propertyId: databaseId,
                      value: {},
                      expectedRevision: { type: 'integer', minimum: 0 },
                    },
                  },
                },
              },
            },
          },
        },
      },
      writeClass: 'write',
      exposures: ['agent'],
      capability: 'database.cells.propose',
      category: 'database',
      targetScope: 'current_database',
      ...WRITE_TOOL_POLICY,
      approvalMode: 'database_cell_revisions',
      execute: async (args, context) => {
        if (!this.databases || context.source !== 'agent')
          throw new ForbiddenException();
        return this.databases.propose(args, context);
      },
    });
    return tools;
  }

  private async searchSpace(
    args: Record<string, unknown>,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const query = this.requireString(args, 'query', false, 512).trim();
    const limit = this.optionalInteger(args, 'limit', 10, 1, 20);
    const excluded = await this.contentPolicy.getExcludedPageIds(
      context.spaceId,
      context.workspaceId,
    );
    const response = await this.search.searchPage(
      { query, spaceId: context.spaceId, limit, offset: 0 },
      {
        userId: context.user.id,
        workspaceId: context.workspaceId,
        excludedPageIds: excluded,
      },
    );
    const pageIds = response.items.map((item) => item.id);
    const [space, dictionaryTerms, pages] = await Promise.all([
      this.db
        .selectFrom('spaces')
        .selectAll()
        .where('id', '=', context.spaceId)
        .where('workspaceId', '=', context.workspaceId)
        .executeTakeFirst(),
      this.knowledgeProjection.searchDictionaryTerms({
        workspaceId: context.workspaceId,
        spaceId: context.spaceId,
        query,
        limit,
      }),
      pageIds.length === 0
        ? Promise.resolve([])
        : this.db
            .selectFrom('pages')
            .select(['id', 'settings'])
            .where('workspaceId', '=', context.workspaceId)
            .where('spaceId', '=', context.spaceId)
            .where('id', 'in', pageIds)
            .execute(),
    ]);
    const documentFields = space
      ? this.knowledgeProjection.getDocumentFieldsConfig(space)
      : { status: false, assignee: false, stakeholders: false, aiRole: false };
    const customFieldsByPageId = new Map(
      pages.map((page) => [
        page.id,
        this.knowledgeProjection.buildCustomFields(
          page.settings,
          documentFields,
        ),
      ]),
    );
    const members = await this.knowledgeProjection.resolveMembers(
      context.workspaceId,
      [...customFieldsByPageId.values()],
    );
    const memberNames = this.knowledgeProjection.memberNames(members);
    const pageItems = response.items.map((item) => {
      const customFields = customFieldsByPageId.get(item.id);
      return {
        pageId: item.id,
        type: (item.databaseId ? 'database_row' : 'page') as
          | 'page'
          | 'database_row',
        databaseId: item.databaseId ?? null,
        title: item.title,
        highlight: item.highlight,
        breadcrumbs: item.breadcrumbs?.map((crumb) => crumb.title) ?? [],
        updatedAt: item.updatedAt,
        customFields,
        documentFieldsMarkdown: this.knowledgeProjection.renderDocumentFields(
          customFields,
          memberNames,
        ),
      };
    });
    const dictionaryItems = dictionaryTerms.map((term) => ({
      pageId: null,
      sourceId: term.id,
      type: 'dictionary_term' as const,
      term: term.term,
      forms: term.forms,
      definitionMarkdown: term.definitionMarkdown.slice(0, 4_000),
      score: term.score,
      exact: term.exact,
      deepLink: space
        ? `/s/${encodeURIComponent(space.slug)}/dictionary?term=${encodeURIComponent(term.id)}`
        : null,
    }));
    const items = [
      ...dictionaryItems.filter((item) => item.exact),
      ...pageItems,
      ...dictionaryItems.filter((item) => !item.exact),
    ].slice(0, limit);
    const pageResults = items.filter(
      (item): item is (typeof pageItems)[number] =>
        item.type !== 'dictionary_term',
    );
    const dictionaryResults = items.filter(
      (item): item is (typeof dictionaryItems)[number] =>
        item.type === 'dictionary_term',
    );
    return {
      content: { items },
      citations: [
        ...(await this.pageRootCitations(pageResults, context)),
        ...dictionaryResults.map((term) => ({
          candidateKey: `dictionary_term:${term.sourceId}:root`,
          sourceType: 'dictionary_term' as const,
          sourceId: term.sourceId,
          pageId: null,
          sourceTitle: term.term,
          sourceUrl: term.deepLink,
          excerpt: term.definitionMarkdown || null,
          relevanceScore: term.score,
          sectionId: null,
          sectionTitle: null,
          root: true,
        })),
      ],
    };
  }

  private async getTree(
    context: AiToolExecutionContext,
    cursor?: string,
    limit = 100,
  ): Promise<AiToolExecutionResult> {
    const snapshot = await this.pageAccess.getSidebarAccessSnapshot(
      context.user,
      context.spaceId,
    );
    const excluded = await this.contentPolicy.getExcludedPageIds(
      context.spaceId,
      context.workspaceId,
    );
    const readable = [...snapshot.readablePageIds].filter(
      (id) => !excluded.has(id),
    );
    const rows = readable.length
      ? await this.db
          .selectFrom('pages')
          .select([
            'id',
            'parentPageId',
            'title',
            'slugId',
            'position',
            'updatedAt',
          ])
          .select((eb) =>
            eb
              .selectFrom('databases')
              .select('databases.id')
              .whereRef('databases.pageId', '=', 'pages.id')
              .where('databases.workspaceId', '=', context.workspaceId)
              .where('databases.spaceId', '=', context.spaceId)
              .where('databases.deletedAt', 'is', null)
              .as('databaseId'),
          )
          .where('workspaceId', '=', context.workspaceId)
          .where('spaceId', '=', context.spaceId)
          .where('deletedAt', 'is', null)
          .where('id', 'in', readable)
          .orderBy('id', 'asc')
          .execute()
      : [];
    const items = rows.map((row) => ({
      ...row,
      type: row.databaseId ? 'database' : 'page',
      parentPageId:
        row.parentPageId &&
        snapshot.readablePageIds.has(row.parentPageId) &&
        !excluded.has(row.parentPageId)
          ? row.parentPageId
          : null,
    }));
    const content = paginateReadItems(
      items,
      {},
      {
        tool: 'getTree',
        resource: context.spaceId,
        version: hashReadVersion(items),
        cursor,
        limit,
      },
    );
    const citations = await this.pageRootCitations(
      content.items.map((item: any) => ({ pageId: item.id, type: 'page' })),
      context,
    );
    await this.assertReadResults(
      content.items.map((item: any) => item.id),
      context,
    );
    return { content, citations };
  }

  private async getPageContext(
    pageId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const snapshot = await this.pageAccess.getSidebarAccessSnapshot(
      context.user,
      context.spaceId,
    );
    const excluded = await this.contentPolicy.getExcludedPageIds(
      context.spaceId,
      context.workspaceId,
    );
    const readable = [...snapshot.readablePageIds].filter(
      (id) => !excluded.has(id),
    );
    const [breadcrumbs, children, fields] = await Promise.all([
      this.pages.getPageBreadCrumbs(pageId),
      readable.length
        ? this.db
            .selectFrom('pages')
            .select(['id', 'title', 'slugId', 'position', 'updatedAt'])
            .where('workspaceId', '=', context.workspaceId)
            .where('spaceId', '=', context.spaceId)
            .where('parentPageId', '=', pageId)
            .where('deletedAt', 'is', null)
            .where('id', 'in', readable)
            .orderBy('position', 'asc')
            .orderBy('id', 'asc')
            .execute()
        : [],
      this.projectPageDocumentFields(page, context),
    ]);
    const base = {
      page: {
        id: page.id,
        title: page.title,
        slugId: page.slugId,
        updatedAt: page.updatedAt,
        ...fields,
      },
      breadcrumbs: breadcrumbs
        .filter(
          (item) =>
            snapshot.readablePageIds.has(item.id) && !excluded.has(item.id),
        )
        .map((item) => ({ id: item.id, title: item.title })),
    };
    const content = paginateReadItems(children, base, {
      tool: 'getPageContext',
      resource: pageId,
      version: hashReadVersion(children),
      cursor,
      limit: 50,
      field: 'children',
    });
    const citations = [
      ...(await this.pageCitations(page, undefined, context)),
      ...(await this.pageRootCitations(
        content.children.map((child: any) => ({
          pageId: child.id,
          type: 'page',
        })),
        context,
      )),
    ];
    await this.getReadablePage(pageId, context);
    await this.assertReadResults(
      content.children.map((child: any) => child.id),
      context,
    );
    return { content, citations };
  }

  private async getPage(
    pageId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const document =
      context.source === 'agent' && context.currentPageId === pageId
        ? await this.getLivePageContent(pageId, context, 'read')
        : ((page.content ?? { type: 'doc', content: [] }) as ProseMirrorJson);
    const contentHash = hashProseMirrorJson(document);
    const text = getProseMirrorText(document);
    const fields = await this.projectPageDocumentFields(page, context);
    const base = {
      id: page.id,
      title: page.title,
      slugId: page.slugId,
      updatedAt: page.updatedAt,
      ...fields,
      contentHash,
    };
    let content: Record<string, any> = {
      ...base,
      content: document,
      text,
      truncated: false,
      nextCursor: null,
    };
    if (cursor || !readResultFits(content)) {
      const outline = getAiPageOutline(document).slice(0, 8);
      content = paginateReadText(
        text,
        { ...base, content: null, outline },
        { tool: 'getPage', resource: pageId, version: contentHash, cursor },
      );
      // Missing editor JSON is also an explicit truncation, even when all text fits.
      content.truncated = true;
    }
    const citations = await this.pageCitations(page, document, context);
    await this.revalidateReadDocument(pageId, contentHash, context);
    return { content, citations };
  }

  private async getOutline(
    pageId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const document =
      context.source === 'agent' && context.currentPageId === pageId
        ? await this.getLivePageContent(pageId, context, 'read')
        : ((page.content ?? { type: 'doc', content: [] }) as ProseMirrorJson);
    const contentHash = hashProseMirrorJson(document);
    const content = paginateReadItems(
      getAiPageOutline(document),
      { pageId, contentHash },
      {
        tool: 'getOutline',
        resource: pageId,
        version: contentHash,
        cursor,
        limit: 300,
      },
    );
    const citations = await this.pageCitations(page, document, context);
    await this.revalidateReadDocument(pageId, contentHash, context);
    return { content, citations };
  }

  private async getNode(
    pageId: string,
    nodeId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const document =
      context.source === 'agent' && context.currentPageId === pageId
        ? await this.getLivePageContent(pageId, context, 'read')
        : ((page.content ?? { type: 'doc', content: [] }) as ProseMirrorJson);
    const contentHash = hashProseMirrorJson(document);
    let node: ProseMirrorJson;
    try {
      node = getAiPageNode(document, nodeId);
    } catch {
      throw new NotFoundException('Page node not found or ambiguous');
    }
    const base = { pageId, nodeId, contentHash };
    let content: Record<string, any> = {
      ...base,
      node,
      truncated: false,
      nextCursor: null,
    };
    if (cursor || !readResultFits(content))
      content = paginateReadText(
        JSON.stringify(node),
        { ...base, node: null, encoding: 'json' },
        {
          tool: 'getNode',
          resource: `${pageId}:${nodeId}`,
          version: contentHash,
          cursor,
          field: 'nodeJsonChunk',
        },
      );
    const citations = await this.pageCitations(page, document, context, nodeId);
    await this.revalidateReadDocument(pageId, contentHash, context);
    return { content, citations };
  }

  private async searchInPage(
    pageId: string,
    query: string,
    limit: number,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const text = getProseMirrorText(
      (page.content ?? { type: 'doc', content: [] }) as ProseMirrorJson,
    );
    const normalizedQuery = query.toLocaleLowerCase();
    const normalizedText = text.toLocaleLowerCase();
    const items: Array<{ offset: number; excerpt: string }> = [];
    let offset = 0;
    while (items.length < limit) {
      const match = normalizedText.indexOf(normalizedQuery, offset);
      if (match < 0) break;
      items.push({
        offset: match,
        excerpt: text.slice(
          Math.max(0, match - 120),
          match + query.length + 120,
        ),
      });
      offset = match + Math.max(query.length, 1);
    }
    return {
      content: { pageId, items },
      citations: await this.pageCitations(page, undefined, context),
    };
  }

  private async getComment(
    pageId: string,
    commentId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const load = () =>
      this.db
        .selectFrom('comments as comment')
        .leftJoin('users as creator', 'creator.id', 'comment.creatorId')
        .leftJoin('users as resolver', 'resolver.id', 'comment.resolvedById')
        .select([
          'comment.id',
          'comment.parentCommentId',
          'comment.type',
          'comment.selection',
          'comment.content',
          'comment.createdAt',
          'comment.updatedAt',
          'comment.editedAt',
          'comment.resolvedAt',
          'creator.id as creatorId',
          'creator.name as creatorName',
          'resolver.id as resolvedById',
          'resolver.name as resolvedByName',
        ])
        .where('comment.id', '=', commentId)
        .where('comment.pageId', '=', pageId)
        .where('comment.workspaceId', '=', context.workspaceId)
        .where('comment.spaceId', '=', context.spaceId)
        .where('comment.deletedAt', 'is', null)
        .executeTakeFirst();
    const row = await load();
    if (!row) throw new NotFoundException('Comment not found');
    const { content: document, selection, ...metadata } = row;
    const version = hashReadVersion(row);
    const text = getProseMirrorText((document ?? {}) as ProseMirrorJson);
    const base = {
      pageId,
      ...metadata,
      selection: typeof selection === 'string' ? selection : null,
      version,
    };
    const options = {
      tool: 'getComment',
      resource: `${pageId}:${commentId}`,
      version,
      cursor,
    };
    const content = readResultFits(base, 8 * 1024)
      ? paginateReadText(text, base, options)
      : paginateReadText(
          JSON.stringify({ ...base, content: text }),
          { pageId, commentId, version, encoding: 'json' },
          { ...options, field: 'commentJsonChunk' },
        );
    const citations = await this.pageCitations(page, undefined, context);
    await this.getReadablePage(pageId, context);
    if (hashReadVersion(await load()) !== version)
      throw new ConflictException({
        code: 'MCP_SOURCE_CHANGED',
        message: 'Comment changed; restart reading',
      });
    return { content, citations };
  }

  private async getPageVersion(
    pageId: string,
    historyId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const load = () =>
      this.db
        .selectFrom('pageHistory')
        .select([
          'id',
          'pageId',
          'workspaceId',
          'spaceId',
          'title',
          'version',
          'content',
          'createdAt',
          'updatedAt',
        ])
        .where('id', '=', historyId)
        .where('pageId', '=', pageId)
        .where('workspaceId', '=', context.workspaceId)
        .where('spaceId', '=', context.spaceId)
        .executeTakeFirst();
    const row = await load();
    if (!row?.content) throw new NotFoundException('Page history not found');
    const version = hashReadVersion(row);
    const content = paginateReadText(
      getProseMirrorText(row.content as ProseMirrorJson),
      {
        pageId,
        historyId,
        title: row.title,
        historyVersion: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        version,
      },
      {
        tool: 'getPageVersion',
        resource: `${pageId}:${historyId}`,
        version,
        cursor,
      },
    );
    const citations = await this.pageCitations(page, undefined, context);
    await this.getReadablePage(pageId, context);
    if (hashReadVersion(await load()) !== version)
      throw new ConflictException({
        code: 'MCP_SOURCE_CHANGED',
        message: 'Page history changed; restart reading',
      });
    return { content, citations };
  }

  private async getDatabaseCellContent(
    pageId: string,
    propertyId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const load = async () => {
      const page = await this.getReadablePage(pageId, context);
      const row = await this.db
        .selectFrom('databaseRows')
        .select(['id', 'databaseId', 'pageId', 'createdAt', 'updatedAt'])
        .where('pageId', '=', pageId)
        .where('workspaceId', '=', context.workspaceId)
        .where('archivedAt', 'is', null)
        .executeTakeFirst();
      if (!row) throw new NotFoundException('Database row not found');
      const database = await this.getReadableDatabase(row.databaseId, context);
      const properties = await this.db
        .selectFrom('databaseProperties')
        .select(['id', 'name', 'type', 'settings'])
        .where('databaseId', '=', database.id)
        .where('workspaceId', '=', context.workspaceId)
        .where('deletedAt', 'is', null)
        .execute();
      const property = properties.find((item) => item.id === propertyId);
      if (!property) throw new NotFoundException('Database property not found');
      const cells = await this.db
        .selectFrom('databaseCells')
        .select(['id', 'pageId', 'propertyId', 'value', 'attachmentId'])
        .where('databaseId', '=', database.id)
        .where('pageId', '=', pageId)
        .where('workspaceId', '=', context.workspaceId)
        .where('deletedAt', 'is', null)
        .execute();
      const resolved = (
        await resolveComputedDatabaseRows(
          this.db,
          [{ ...row, cells }],
          properties,
          database.id,
          context.workspaceId,
        )
      )[0];
      if (!resolved) throw new ConflictException('Database row access changed');
      const cell = resolved.cells.find(
        (item) => item.propertyId === propertyId,
      );
      return {
        page,
        database,
        property,
        value: cell ? this.curatedDatabaseCell(cell).value : null,
        schema: properties,
      };
    };
    const row = await load();
    const version = hashReadVersion([row.database.id, row.schema, row.value]);
    const content = paginateReadText(
      JSON.stringify(row.value),
      {
        pageId,
        databaseId: row.database.id,
        propertyId,
        propertyName: row.property.name,
        propertyType: row.property.type,
        encoding: 'json',
        version,
      },
      {
        tool: 'getDatabaseCellContent',
        resource: `${pageId}:${propertyId}`,
        version,
        cursor,
        field: 'valueJsonChunk',
      },
    );
    const citations = await this.pageRootCitations(
      [
        { pageId, type: 'database_row' },
        { pageId: row.database.pageId, type: 'page' },
      ],
      context,
    );
    const current = await load();
    if (
      hashReadVersion([current.database.id, current.schema, current.value]) !==
      version
    )
      throw new ConflictException({
        code: 'MCP_SOURCE_CHANGED',
        message: 'Database cell changed; restart reading',
      });
    return { content, citations };
  }

  private async getPageMetadata(
    pageId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const metadata = await this.resolvePageMetadata(page, context);
    const version = hashReadVersion(metadata);
    const content = paginateReadText(
      JSON.stringify(metadata),
      { pageId, encoding: 'json', version },
      {
        tool: 'getPageMetadata',
        resource: pageId,
        version,
        cursor,
        field: 'metadataJsonChunk',
      },
    );
    const citations = await this.pageCitations(page, undefined, context);
    const current = await this.getReadablePage(pageId, context);
    if (
      hashReadVersion(await this.resolvePageMetadata(current, context)) !==
      version
    )
      throw new ConflictException({
        code: 'MCP_SOURCE_CHANGED',
        message: 'Page metadata changed; restart reading',
      });
    return { content, citations };
  }

  private async revalidateReadDocument(
    pageId: string,
    contentHash: string,
    context: AiToolExecutionContext,
  ) {
    const page = await this.getReadablePage(pageId, context);
    const document =
      context.source === 'agent' && context.currentPageId === pageId
        ? await this.getLivePageContent(pageId, context, 'read')
        : ((page.content ?? { type: 'doc', content: [] }) as ProseMirrorJson);
    if (hashProseMirrorJson(document) !== contentHash)
      throw new ConflictException({
        code: 'MCP_SOURCE_CHANGED',
        message: 'Document changed; restart reading',
      });
  }

  private async assertReadResults(
    ids: string[],
    context: AiToolExecutionContext,
  ) {
    if (!ids.length) return;
    const snapshot = await this.pageAccess.getSidebarAccessSnapshot(
      context.user,
      context.spaceId,
    );
    const excluded = await this.contentPolicy.getExcludedPageIds(
      context.spaceId,
      context.workspaceId,
    );
    if (ids.some((id) => !snapshot.readablePageIds.has(id) || excluded.has(id)))
      throw new ConflictException({
        code: 'MCP_SOURCE_CHANGED',
        message: 'Source access changed; restart reading',
      });
  }

  private async getWorkspaceContext(
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const workspace = await this.db
      .selectFrom('workspaces')
      .select(['id', 'name', 'description', 'logo'])
      .where('id', '=', context.workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!workspace) throw new NotFoundException('Workspace not found');
    return {
      content: {
        workspace,
        actor: { id: context.user.id, role: context.user.role },
      },
    };
  }

  private async getSpaceContext(
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const space = await this.db
      .selectFrom('spaces')
      .select([
        'id',
        'name',
        'slug',
        'description',
        'logo',
        'visibility',
        'archivedAt',
      ])
      .where('id', '=', context.spaceId)
      .where('workspaceId', '=', context.workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!space) throw new NotFoundException('Space not found');
    const [ability, spaceRoles] = await Promise.all([
      this.spaceAbility.createForUser(context.user, context.spaceId),
      this.spaceMemberRepo.getUserSpaceRoles(context.user.id, context.spaceId),
    ]);
    const spaceRole =
      (findHighestUserSpaceRole(spaceRoles) as SpaceRole | undefined) ?? null;
    return {
      content: {
        space,
        actor: {
          id: context.user.id,
          workspaceRole: context.user.role,
          spaceRole,
          capabilities: {
            readPages: ability.can(SpaceCaslAction.Read, SpaceCaslSubject.Page),
            createPages: ability.can(
              SpaceCaslAction.Create,
              SpaceCaslSubject.Page,
            ),
            manageSettings: ability.can(
              SpaceCaslAction.Manage,
              SpaceCaslSubject.Settings,
            ),
          },
        },
      },
    };
  }

  private async getDatabaseContext(
    databaseId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const database = await this.getReadableDatabase(databaseId, context);
    const databasePage = await this.getReadablePage(database.pageId, context);
    const [properties, views] = await Promise.all([
      this.db
        .selectFrom('databaseProperties')
        .select(['id', 'name', 'type', 'position', 'settings'])
        .where('databaseId', '=', database.id)
        .where('workspaceId', '=', context.workspaceId)
        .where('deletedAt', 'is', null)
        .orderBy('position', 'asc')
        .execute(),
      this.db
        .selectFrom('databaseViews')
        .select(['id', 'name', 'type'])
        .where('databaseId', '=', database.id)
        .where('workspaceId', '=', context.workspaceId)
        .where('deletedAt', 'is', null)
        .orderBy('createdAt', 'asc')
        .execute(),
    ]);
    const projectedFields = await this.projectPageDocumentFields(
      databasePage,
      context,
    );
    return {
      content: this.boundReadContext(
        'getDatabaseContext',
        databaseId,
        {
          database: { ...this.curatedDatabase(database), ...projectedFields },
          properties: properties.map((property) =>
            this.curatedDatabaseProperty(property),
          ),
          views,
        },
        cursor,
        24 * 1024,
      ),
      citations: await this.pageRootCitations(
        [{ pageId: database.pageId, type: 'page' }],
        context,
      ),
    };
  }

  private async listDatabaseRows(
    databaseId: string,
    limit: number,
    cursor: string | undefined,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const database = await this.getReadableDatabase(databaseId, context);
    const keyset = this.decodeCursor(cursor, 'listDatabaseRows', databaseId);
    const snapshot = await this.pageAccess.getSidebarAccessSnapshot(
      context.user,
      context.spaceId,
    );
    const excluded = await this.contentPolicy.getExcludedPageIds(
      context.spaceId,
      context.workspaceId,
    );
    const eligiblePageIds = [...snapshot.readablePageIds].filter(
      (pageId) => !excluded.has(pageId),
    );
    let rawRowsQuery = this.db
      .selectFrom('databaseRows as row')
      .innerJoin('pages as page', 'page.id', 'row.pageId')
      .select([
        'row.id',
        'row.pageId',
        'row.createdAt',
        'row.updatedAt',
        'page.title',
        'page.slugId',
        'page.icon',
        'page.settings',
      ])
      .where('row.databaseId', '=', database.id)
      .where('row.workspaceId', '=', context.workspaceId)
      .where('row.archivedAt', 'is', null)
      .where('page.workspaceId', '=', context.workspaceId)
      .where('page.spaceId', '=', context.spaceId)
      .where('page.deletedAt', 'is', null)
      .where(sql<boolean>`page.id = any(${eligiblePageIds}::uuid[])`);
    if (keyset) {
      rawRowsQuery = rawRowsQuery.where((eb) =>
        eb.or([
          eb('row.updatedAt', '<', keyset.sortAt),
          eb.and([
            eb('row.updatedAt', '=', keyset.sortAt),
            eb('row.id', '<', keyset.id),
          ]),
        ]),
      );
    }
    const rawRows = await rawRowsQuery
      .orderBy('row.updatedAt', 'desc')
      .orderBy('row.id', 'desc')
      .limit(limit + 1)
      .execute();
    const hasMore = rawRows.length > limit;
    const pageRows = rawRows.slice(0, limit);
    const readableRows = pageRows.filter(
      (row) =>
        snapshot.readablePageIds.has(row.pageId) && !excluded.has(row.pageId),
    );
    const pageIds = readableRows.map((row) => row.pageId);
    const [cells, properties] = pageIds.length
      ? await Promise.all([
          this.db
            .selectFrom('databaseCells')
            .select(['id', 'pageId', 'propertyId', 'value', 'attachmentId'])
            .where('databaseId', '=', database.id)
            .where('workspaceId', '=', context.workspaceId)
            .where('pageId', 'in', pageIds)
            .where('deletedAt', 'is', null)
            .execute(),
          this.db
            .selectFrom('databaseProperties')
            .select(['id', 'name', 'type', 'settings'])
            .where('databaseId', '=', database.id)
            .where('workspaceId', '=', context.workspaceId)
            .where('deletedAt', 'is', null)
            .orderBy('position', 'asc')
            .execute(),
        ])
      : [[], []];
    const projectedRows = await resolveComputedDatabaseRows(
      this.db,
      readableRows.map((row) => ({
        ...row,
        cells: cells.filter((cell) => cell.pageId === row.pageId),
      })),
      properties,
      database.id,
      context.workspaceId,
    );
    const cellsByPage = new Map<string, typeof cells>();
    for (const cell of projectedRows.flatMap((row) => row.cells)) {
      const values = cellsByPage.get(cell.pageId) ?? [];
      values.push(this.curatedDatabaseCell(cell) as (typeof cells)[number]);
      cellsByPage.set(cell.pageId, values);
    }
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', context.spaceId)
      .where('workspaceId', '=', context.workspaceId)
      .executeTakeFirstOrThrow();
    const documentFields =
      this.knowledgeProjection.getDocumentFieldsConfig(space);
    const rowFields = readableRows.map((row) =>
      this.knowledgeProjection.buildCustomFields(row.settings, documentFields),
    );
    const members = await this.knowledgeProjection.resolveMembers(
      context.workspaceId,
      rowFields,
    );
    const memberNames = this.knowledgeProjection.memberNames(members);
    const items = readableRows.map((row, index) => {
      const customFields = rowFields[index];
      const { settings: _settings, ...safeRow } = row;
      const rendered = this.knowledgeProjection.renderRowFields(
        properties,
        cellsByPage.get(row.pageId) ?? [],
      );
      return {
        ...safeRow,
        customFields,
        documentFieldsMarkdown: this.knowledgeProjection.renderDocumentFields(
          customFields,
          memberNames,
        ),
        cells: this.compactReadCells(rendered.cells, row.pageId),
      };
    });
    for (let index = 0; index < items.length; index++) {
      if (!readResultFits(items[index], 24 * 1024)) {
        items[index] = {
          ...items[index],
          cells: [],
          cellsTruncated: true,
          cellContentTool: 'getDatabaseCellContent',
        } as (typeof items)[number];
      }
    }
    const fitted = fitAiToolItems(items, 27 * 1024);
    if (fitted.truncated && !fitted.items.length)
      throw new AiToolResultLimitError();
    const consumedRows = fitted.truncated
      ? Math.max(
          1,
          pageRows.findIndex(
            (row) =>
              row.pageId === fitted.items[fitted.items.length - 1]?.pageId,
          ) + 1,
        )
      : pageRows.length;
    const cursorRow = pageRows[consumedRows - 1];
    const citations = await this.pageRootCitations(
      [
        { pageId: database.pageId, type: 'page' },
        ...fitted.items.map((row) => ({
          pageId: row.pageId,
          type: 'database_row' as const,
        })),
      ],
      context,
    );
    const currentDatabase = await this.getReadableDatabase(databaseId, context);
    const currentSnapshot = await this.pageAccess.getSidebarAccessSnapshot(
      context.user,
      context.spaceId,
    );
    const currentExcluded = await this.contentPolicy.getExcludedPageIds(
      context.spaceId,
      context.workspaceId,
    );
    const rootPageId = database.pageId ?? database.id;
    if (
      (currentDatabase.pageId ?? currentDatabase.id) !== rootPageId ||
      !currentSnapshot.readablePageIds.has(rootPageId) ||
      currentExcluded.has(rootPageId) ||
      rawRows.some(
        (row) =>
          !currentSnapshot.readablePageIds.has(row.pageId) ||
          currentExcluded.has(row.pageId),
      )
    ) {
      throw new ConflictException('Database row access changed; query again');
    }
    return {
      content: {
        databaseId,
        items: fitted.items,
        nextCursor:
          (hasMore || fitted.truncated) && cursorRow
            ? this.encodeCursor('listDatabaseRows', databaseId, {
                sortAt: cursorRow.updatedAt,
                id: cursorRow.id,
              })
            : null,
        truncated: hasMore || fitted.truncated,
      },
      citations,
    };
  }

  private async getDatabaseRowContext(
    pageId: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const row = await this.db
      .selectFrom('databaseRows')
      .select(['id', 'databaseId', 'pageId', 'createdAt', 'updatedAt'])
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', context.workspaceId)
      .where('archivedAt', 'is', null)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Database row not found');
    const database = await this.getReadableDatabase(row.databaseId, context);
    const [properties, storedCells] = await Promise.all([
      this.db
        .selectFrom('databaseProperties')
        .select(['id', 'name', 'type', 'position', 'settings'])
        .where('databaseId', '=', database.id)
        .where('workspaceId', '=', context.workspaceId)
        .where('deletedAt', 'is', null)
        .orderBy('position', 'asc')
        .execute(),
      this.db
        .selectFrom('databaseCells')
        .select(['id', 'propertyId', 'value', 'attachmentId'])
        .where('databaseId', '=', database.id)
        .where('pageId', '=', pageId)
        .where('workspaceId', '=', context.workspaceId)
        .where('deletedAt', 'is', null)
        .execute(),
    ]);
    const cells =
      (
        await resolveComputedDatabaseRows(
          this.db,
          [{ ...row, cells: storedCells }],
          properties,
          database.id,
          context.workspaceId,
        )
      )[0]?.cells ?? [];
    const projectedFields = await this.projectPageDocumentFields(page, context);
    const renderedCells = this.knowledgeProjection.renderRowFields(
      properties,
      cells,
    );
    return {
      content: this.boundReadContext(
        'getDatabaseRowContext',
        pageId,
        {
          database: this.curatedDatabase(database),
          row: {
            ...row,
            title: page.title,
            slugId: page.slugId,
            icon: page.icon,
            ...projectedFields,
          },
          properties: properties.map((property) =>
            this.curatedDatabaseProperty(property),
          ),
          cells: this.compactReadCells(renderedCells.cells, pageId),
        },
        cursor,
        24 * 1024,
      ),
      citations: await this.pageRootCitations(
        [
          { pageId: page.id, type: 'database_row' },
          { pageId: database.pageId, type: 'page' },
        ],
        context,
      ),
    };
  }

  private async getTable(
    pageId: string,
    tableRef: string,
    context: AiToolExecutionContext,
    cursor?: string,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const document = (page.content ?? {
      type: 'doc',
      content: [],
    }) as ProseMirrorJson;
    const contentHash = hashProseMirrorJson(document);
    const resolved = this.findTable(document, tableRef);
    if (!resolved) throw new NotFoundException('Table not found');
    const nodes = new Map<ProseMirrorJson, string>();
    let index = 0;
    // Indexes advance for every structural node, including nodes with stable IDs.
    index = 0;
    const indexNodes = (node: ProseMirrorJson) => {
      if (node.type !== 'doc' && node.type !== 'text') {
        nodes.set(
          node,
          typeof node.attrs?.id === 'string' ? node.attrs.id : `#${index}`,
        );
        index++;
      }
      for (const child of node.content ?? []) indexNodes(child);
    };
    indexNodes(document);
    const rows = (resolved.table.content ?? []).filter(
      (node) => node.type === 'tableRow',
    );
    const items = rows.flatMap((row, rowIndex) => {
      const cells = row.content ?? [];
      return Array.from(
        { length: Math.max(1, Math.ceil(cells.length / 50)) },
        (_, fragment) => {
          const selected = cells.slice(fragment * 50, (fragment + 1) * 50);
          return {
            rowIndex,
            columnOffset: fragment * 50,
            cells: selected.map((cell) =>
              getProseMirrorText(cell).slice(0, 1000),
            ),
            cellIds: selected.map((cell) =>
              typeof cell.content?.[0]?.attrs?.id === 'string'
                ? cell.content[0].attrs.id
                : null,
            ),
            cellRefs: selected.map((cell) => nodes.get(cell) ?? null),
            cellTruncated: selected.map(
              (cell) => getProseMirrorText(cell).length > 1000,
            ),
          };
        },
      );
    });
    // A wide row still has a readable reference for each cell.
    for (let i = 0; i < items.length; i++)
      if (!readResultFits(items[i], 12 * 1024)) {
        items[i].cells = items[i].cells.map(() => '');
        items[i].cellTruncated = items[i].cellTruncated.map(() => true);
      }
    const base = {
      pageId,
      tableRef,
      contentHash,
      path: resolved.path,
      rows: rows.length,
      cols: rows[0]?.content?.length ?? 0,
    };
    const fitted = paginateReadItems(items, base, {
      tool: 'getTable',
      resource: `${pageId}:${tableRef}`,
      version: contentHash,
      cursor,
      maxBytes: 30 * 1024,
    });
    const { items: selected, ...rest } = fitted;
    const content = {
      ...rest,
      cells: selected.map((row: any) => row.cells),
      cellIds: selected.map((row: any) => row.cellIds),
      rowIndices: selected.map((row: any) => row.rowIndex),
      columnOffsets: selected.map((row: any) => row.columnOffset),
      cellRefs: selected.map((row: any) => row.cellRefs),
      cellTruncated: selected.map((row: any) => row.cellTruncated),
    };
    const citations = await this.pageCitations(
      page,
      document,
      context,
      tableRef,
    );
    await this.revalidateReadDocument(pageId, contentHash, context);
    return { content, citations };
  }

  private async listComments(
    pageId: string,
    limit: number,
    cursor: string | undefined,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const keyset = this.decodeCursor(cursor, 'listComments', pageId);
    let commentsQuery = this.db
      .selectFrom('comments as comment')
      .leftJoin('users as creator', 'creator.id', 'comment.creatorId')
      .leftJoin('users as resolver', 'resolver.id', 'comment.resolvedById')
      .select([
        'comment.id',
        'comment.parentCommentId',
        'comment.type',
        'comment.selection',
        'comment.content',
        'comment.createdAt',
        'comment.updatedAt',
        'comment.editedAt',
        'comment.resolvedAt',
        'creator.id as creatorId',
        'creator.name as creatorName',
        'creator.avatarUrl as creatorAvatarUrl',
        'resolver.id as resolvedById',
        'resolver.name as resolvedByName',
      ])
      .where('comment.pageId', '=', pageId)
      .where('comment.workspaceId', '=', context.workspaceId)
      .where('comment.spaceId', '=', context.spaceId)
      .where('comment.deletedAt', 'is', null);
    if (keyset) {
      commentsQuery = commentsQuery.where((eb) =>
        eb.or([
          eb('comment.createdAt', '<', keyset.sortAt),
          eb.and([
            eb('comment.createdAt', '=', keyset.sortAt),
            eb('comment.id', '<', keyset.id),
          ]),
        ]),
      );
    }
    const rows = await commentsQuery
      .orderBy('comment.createdAt', 'desc')
      .orderBy('comment.id', 'desc')
      .limit(limit + 1)
      .execute();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(({ content, ...row }) => {
      const text = getProseMirrorText(
        (content ?? { type: 'doc', content: [] }) as ProseMirrorJson,
      );
      return {
        ...row,
        content: text.slice(0, 2000),
        contentTruncated: text.length > 2000,
      };
    });
    const fitted = fitAiToolItems(items, 20 * 1024);
    const cursorRow = rows[Math.max(fitted.items.length, 1) - 1];
    return {
      content: {
        pageId,
        items: fitted.items,
        nextCursor:
          (hasMore || fitted.truncated) && cursorRow
            ? this.encodeCursor('listComments', pageId, {
                sortAt: cursorRow.createdAt,
                id: cursorRow.id,
              })
            : null,
        truncated: hasMore || fitted.truncated,
      },
      citations: await this.pageCitations(page, undefined, context),
    };
  }

  private async listPageHistory(
    pageId: string,
    limit: number,
    cursor: string | undefined,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const keyset = this.decodeCursor(cursor, 'listPageHistory', pageId);
    let historyQuery = this.db
      .selectFrom('pageHistory as history')
      .leftJoin('users as actor', 'actor.id', 'history.lastUpdatedById')
      .select([
        'history.id',
        'history.version',
        'history.title',
        'history.changeType',
        'history.createdAt',
        'history.updatedAt',
        'actor.id as actorId',
        'actor.name as actorName',
        'actor.avatarUrl as actorAvatarUrl',
      ])
      .where('history.pageId', '=', pageId)
      .where('history.workspaceId', '=', context.workspaceId)
      .where('history.spaceId', '=', context.spaceId);
    if (keyset) {
      historyQuery = historyQuery.where((eb) =>
        eb.or([
          eb('history.createdAt', '<', keyset.sortAt),
          eb.and([
            eb('history.createdAt', '=', keyset.sortAt),
            eb('history.id', '<', keyset.id),
          ]),
        ]),
      );
    }
    const rows = await historyQuery
      .orderBy('history.createdAt', 'desc')
      .orderBy('history.id', 'desc')
      .limit(limit + 1)
      .execute();
    const hasMore = rows.length > limit;
    const fitted = fitAiToolItems(rows.slice(0, limit), 12 * 1024);
    const cursorRow = rows[Math.max(fitted.items.length, 1) - 1];
    return {
      content: {
        pageId,
        items: fitted.items,
        nextCursor:
          (hasMore || fitted.truncated) && cursorRow
            ? this.encodeCursor('listPageHistory', pageId, {
                sortAt: cursorRow.createdAt,
                id: cursorRow.id,
              })
            : null,
        truncated: hasMore || fitted.truncated,
      },
      citations: await this.pageCitations(page, undefined, context),
    };
  }

  private async diffPageVersion(
    pageId: string,
    historyId: string,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const history = await this.db
      .selectFrom('pageHistory')
      .select([
        'id',
        'pageId',
        'workspaceId',
        'spaceId',
        'content',
        'createdAt',
      ])
      .where('id', '=', historyId)
      .executeTakeFirst();
    if (
      !history ||
      history.pageId !== pageId ||
      history.workspaceId !== context.workspaceId ||
      history.spaceId !== context.spaceId ||
      !history.content
    ) {
      throw new NotFoundException('Page history not found');
    }
    const live = await this.getLivePageContent(pageId, context, 'read');
    const diff = diffProseMirrorDocuments(
      jsonToNode(history.content as any),
      jsonToNode(live as any),
    );
    const fitted = fitAiToolItems(diff.changes, 24 * 1024);
    return {
      content: {
        pageId,
        historyId,
        historyCreatedAt: history.createdAt,
        currentContentHash: hashProseMirrorJson(live),
        summary: diff.summary,
        integrity: diff.integrity,
        precise: diff.precise,
        changes: fitted.items,
        truncated: fitted.truncated,
      },
      citations: await this.pageCitations(page, live, context),
    };
  }

  private async listTransclusionReferences(
    sourcePageId: string,
    transclusionId: string,
    limit: number,
    cursor: string | undefined,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const source = await this.getReadablePage(sourcePageId, context);
    const resourceId = `${sourcePageId}:${transclusionId}`;
    const keyset = this.decodeCursor(
      cursor,
      'listTransclusionReferences',
      resourceId,
    );
    let referencesQuery = this.db
      .selectFrom('pageTransclusionReferences as reference')
      .innerJoin('pages as page', 'page.id', 'reference.referencePageId')
      .select([
        'page.id',
        'page.title',
        'page.slugId',
        'page.icon',
        'page.updatedAt',
        'page.templateKind',
      ])
      .where('reference.sourcePageId', '=', sourcePageId)
      .where('reference.transclusionId', '=', transclusionId)
      .where('reference.workspaceId', '=', context.workspaceId)
      .where('page.workspaceId', '=', context.workspaceId)
      .where('page.spaceId', '=', context.spaceId)
      .where('page.deletedAt', 'is', null);
    if (keyset) {
      referencesQuery = referencesQuery.where((eb) =>
        eb.or([
          eb('page.updatedAt', '<', keyset.sortAt),
          eb.and([
            eb('page.updatedAt', '=', keyset.sortAt),
            eb('page.id', '<', keyset.id),
          ]),
        ]),
      );
    }
    const rows = await referencesQuery
      .orderBy('page.updatedAt', 'desc')
      .orderBy('page.id', 'desc')
      .limit(limit + 1)
      .execute();
    const hasMore = rows.length > limit;
    const candidates = rows.slice(0, limit);
    const snapshot = await this.pageAccess.getSidebarAccessSnapshot(
      context.user,
      context.spaceId,
    );
    const excluded = await this.contentPolicy.getExcludedPageIds(
      context.spaceId,
      context.workspaceId,
    );
    const items = candidates.filter(
      (page) => snapshot.readablePageIds.has(page.id) && !excluded.has(page.id),
    );
    const fitted = fitAiToolItems(items, 12 * 1024);
    const consumedReferences = fitted.truncated
      ? Math.max(
          1,
          candidates.findIndex(
            (page) => page.id === fitted.items[fitted.items.length - 1]?.id,
          ) + 1,
        )
      : candidates.length;
    const cursorRow = candidates[consumedReferences - 1];
    return {
      content: {
        source: {
          id: source.id,
          title: source.title,
          slugId: source.slugId,
        },
        transclusionId,
        items: fitted.items,
        nextCursor:
          (hasMore || fitted.truncated) && cursorRow
            ? this.encodeCursor('listTransclusionReferences', resourceId, {
                sortAt: cursorRow.updatedAt,
                id: cursorRow.id,
              })
            : null,
        truncated: hasMore || fitted.truncated,
      },
      citations: await this.pageRootCitations(
        [
          { pageId: source.id, type: 'page' },
          ...fitted.items.map((page) => ({
            pageId: page.id,
            type: 'page' as const,
          })),
        ],
        context,
      ),
    };
  }

  private async listPageAttachments(
    pageId: string,
    limit: number,
    cursor: string | undefined,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const keyset = this.decodeCursor(cursor, 'listPageAttachments', pageId);
    let attachmentsQuery = this.db
      .selectFrom('attachments')
      .select([
        'id',
        'fileName',
        'mimeType',
        'fileSize',
        'fileExt',
        'type',
        'createdAt',
        'updatedAt',
        'contentIndexStatus',
        'contentIndexedAt',
      ])
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', context.workspaceId)
      .where('spaceId', '=', context.spaceId)
      .where('deletedAt', 'is', null);
    if (keyset) {
      attachmentsQuery = attachmentsQuery.where((eb) =>
        eb.or([
          eb('createdAt', '<', keyset.sortAt),
          eb.and([
            eb('createdAt', '=', keyset.sortAt),
            eb('id', '<', keyset.id),
          ]),
        ]),
      );
    }
    const rows = await attachmentsQuery
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      ...row,
      fileSize: row.fileSize === null ? null : String(row.fileSize),
    }));
    const fitted = fitAiToolItems(items, 12 * 1024);
    const cursorRow = rows[Math.max(fitted.items.length, 1) - 1];
    return {
      content: {
        pageId,
        items: fitted.items,
        nextCursor:
          (hasMore || fitted.truncated) && cursorRow
            ? this.encodeCursor('listPageAttachments', pageId, {
                sortAt: cursorRow.createdAt,
                id: cursorRow.id,
              })
            : null,
        truncated: hasMore || fitted.truncated,
      },
      citations: await this.pageCitations(page, undefined, context),
    };
  }

  private async listPageTemplates(
    query: string | undefined,
    limit: number,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    await this.assertPageTemplateToolPolicy(context);
    const [snapshot, excluded] = await Promise.all([
      this.pageAccess.getSidebarAccessSnapshot(context.user, context.spaceId),
      this.contentPolicy.getExcludedPageIds(
        context.spaceId,
        context.workspaceId,
      ),
    ]);
    const readablePageIds = Array.from(snapshot.readablePageIds).filter(
      (pageId) => !excluded.has(pageId),
    );
    if (readablePageIds.length === 0) {
      return { content: { items: [], truncated: false }, citations: [] };
    }
    let selection = this.db
      .selectFrom('pages as page')
      .select([
        'page.id',
        'page.title',
        'page.slugId',
        'page.icon',
        'page.updatedAt',
      ])
      .where('page.workspaceId', '=', context.workspaceId)
      .where('page.spaceId', '=', context.spaceId)
      .where('page.templateKind', 'is not', null)
      .where('page.templateArchivedAt', 'is', null)
      .where('page.deletedAt', 'is', null)
      .where('page.id', 'in', readablePageIds)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('databases')
              .select('databases.id')
              .whereRef('databases.pageId', '=', 'page.id')
              .where('databases.deletedAt', 'is', null),
          ),
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('databaseRows')
              .select('databaseRows.id')
              .whereRef('databaseRows.pageId', '=', 'page.id')
              .where('databaseRows.archivedAt', 'is', null),
          ),
        ),
      )
      .orderBy('page.updatedAt', 'desc')
      .limit(limit + 1);
    if (query?.trim()) {
      selection = selection.where('page.title', 'ilike', `%${query.trim()}%`);
    }
    const rows = await selection.execute();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const fitted = fitAiToolItems(items, 12 * 1024);
    return {
      content: {
        items: fitted.items,
        truncated: hasMore || fitted.truncated,
      },
      citations: await this.pageRootCitations(
        fitted.items.map((page) => ({ pageId: page.id, type: 'page' })),
        context,
      ),
    };
  }

  private async getPageTemplateMetadata(
    pageId: string,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    await this.assertPageTemplateToolPolicy(context);
    const page = await this.getReadablePage(pageId, context);
    if (!page.templateKind) throw new NotFoundException('Template not found');
    return {
      content: {
        id: page.id,
        title: page.title,
        slugId: page.slugId,
        icon: page.icon,
        spaceId: page.spaceId,
        updatedAt: page.updatedAt,
        templateKind: page.templateKind,
        archivedAt: page.templateArchivedAt,
      },
      citations: await this.pageCitations(page, undefined, context),
    };
  }

  private async listPageTemplateUsages(
    pageId: string,
    limit: number,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    await this.assertPageTemplateToolPolicy(context);
    const source = await this.getReadablePage(pageId, context);
    if (!source.templateKind) throw new NotFoundException('Template not found');
    const [snapshot, excluded] = await Promise.all([
      this.pageAccess.getSidebarAccessSnapshot(context.user, context.spaceId),
      this.contentPolicy.getExcludedPageIds(
        context.spaceId,
        context.workspaceId,
      ),
    ]);
    const readablePageIds = Array.from(snapshot.readablePageIds).filter(
      (readablePageId) => !excluded.has(readablePageId),
    );
    const rows =
      readablePageIds.length === 0
        ? []
        : await this.db
            .selectFrom('pageTemplateInstances as instance')
            .innerJoin('pages as page', 'page.id', 'instance.childPageId')
            .select([
              'page.id',
              'page.title',
              'page.slugId',
              'page.icon',
              'page.updatedAt',
              'instance.instanceKind',
              'instance.status',
              'instance.appliedRevision',
            ])
            .where('instance.workspaceId', '=', context.workspaceId)
            .where('instance.templatePageId', '=', pageId)
            .where('instance.status', 'in', [
              'snapshot',
              'active',
              'syncing',
              'error',
            ])
            .where('page.workspaceId', '=', context.workspaceId)
            .where('page.spaceId', '=', context.spaceId)
            .where('page.deletedAt', 'is', null)
            .where('page.id', 'in', readablePageIds)
            .orderBy('page.updatedAt', 'desc')
            .execute();
    const items = rows.slice(0, limit);
    const fitted = fitAiToolItems(items, 12 * 1024);
    return {
      content: {
        source: { id: source.id, title: source.title, slugId: source.slugId },
        items: fitted.items,
        occurrenceCount: rows.length,
        truncated: rows.length > limit || fitted.truncated,
      },
      citations: [
        ...(await this.pageCitations(source, undefined, context)),
        ...(await this.pageRootCitations(
          fitted.items.map((page) => ({ pageId: page.id, type: 'page' })),
          context,
        )),
      ],
    };
  }

  private async assertPageTemplateToolPolicy(
    context: AiToolExecutionContext,
  ): Promise<void> {
    const policy = await this.pageTemplatePolicy.resolveForUser(
      context.workspaceId,
      context.spaceId,
      context.user.id,
    );
    if (
      !policy.systemEnabled ||
      !policy.templatesEnabled ||
      !policy.allowedActions.some((action) =>
        [
          'create_template',
          'manage_template',
          'use_regular_template',
          'use_synced_template',
        ].includes(action),
      )
    ) {
      throw new ForbiddenException('Page templates are disabled by policy');
    }
  }

  private async getPublicShareInfo(
    pageId: string,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const sharingAllowed = await this.shareService.isSharingAllowed(
      context.workspaceId,
      context.spaceId,
    );
    if (!sharingAllowed) {
      return {
        content: { pageId, isPublic: false, disabled: true },
        citations: await this.pageCitations(page, undefined, context),
      };
    }
    const share = await this.shareService.getShareForPage(
      page.slugId,
      context.workspaceId,
    );
    return {
      content: share
        ? {
            pageId,
            isPublic: true,
            inherited: Number(share.level) > 0,
            sharedFromPageId: share.pageId,
            includeSubPages: share.includeSubPages,
            searchIndexing: share.searchIndexing,
            publicUrl: `${this.environment.getAppUrl().replace(/\/+$/, '')}/share/${encodeURIComponent(String(share.key))}/p/${encodeURIComponent(page.slugId)}`,
          }
        : { pageId, isPublic: false },
      citations: await this.pageCitations(page, undefined, context),
    };
  }

  private async getReadableDatabase(
    databaseId: string,
    context: AiToolExecutionContext,
  ) {
    const database = await this.db
      .selectFrom('databases')
      .select([
        'id',
        'name',
        'description',
        'icon',
        'pageId',
        'spaceId',
        'workspaceId',
        'createdAt',
        'updatedAt',
      ])
      .where('id', '=', databaseId)
      .where('workspaceId', '=', context.workspaceId)
      .where('spaceId', '=', context.spaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!database?.pageId) throw new NotFoundException('Database not found');
    await this.getReadablePage(database.pageId, context);
    return database;
  }

  private compactReadCells<T extends { propertyId: string; value: unknown }>(
    cells: T[],
    pageId: string,
  ) {
    return cells.map((cell) =>
      readResultFits(cell, 2048)
        ? cell
        : {
            ...cell,
            value: null,
            valueTruncated: true,
            valueRef: {
              tool: 'getDatabaseCellContent',
              pageId,
              propertyId: cell.propertyId,
            },
          },
    );
  }

  private boundReadContext(
    tool: string,
    resource: string,
    full: Record<string, any>,
    cursor: string | undefined,
    maxBytes: number,
  ) {
    if (!cursor && readResultFits(full, maxBytes)) return full;
    const version = hashReadVersion(full);
    return paginateReadText(
      JSON.stringify(full),
      {
        database: full.database
          ? {
              id: full.database.id,
              pageId: full.database.pageId,
              name: full.database.name,
            }
          : undefined,
        row: full.row
          ? { id: full.row.id, pageId: full.row.pageId, title: full.row.title }
          : undefined,
        properties: [],
        cells: [],
        views: [],
        encoding: 'json',
        version,
      },
      { tool, resource, version, cursor, maxBytes, field: 'contextJsonChunk' },
    );
  }

  private curatedDatabase(database: any) {
    return {
      id: database.id,
      name: database.name,
      description: database.description,
      icon: database.icon,
      pageId: database.pageId,
      spaceId: database.spaceId,
      createdAt: database.createdAt,
      updatedAt: database.updatedAt,
    };
  }

  private curatedDatabaseProperty(property: any) {
    const settings =
      (property.type === 'select' || property.type === 'status') &&
      property.settings &&
      typeof property.settings === 'object' &&
      Array.isArray((property.settings as any).options)
        ? {
            options: (property.settings as any).options
              .slice(0, 100)
              .map((option: any) => ({
                label: String(option?.label ?? '').slice(0, 255),
                value: String(option?.value ?? '').slice(0, 255),
                ...(typeof option?.color === 'string'
                  ? { color: option.color.slice(0, 64) }
                  : {}),
              })),
          }
        : null;
    return {
      id: property.id,
      name: property.name,
      type: property.type,
      position: property.position,
      settings,
    };
  }

  private curatedDatabaseCell(cell: any) {
    const rawValue = cell.value;
    const value =
      rawValue &&
      typeof rawValue === 'object' &&
      !Array.isArray(rawValue) &&
      'value' in rawValue &&
      'rawValueBeforeTypeChange' in rawValue
        ? rawValue.value
        : rawValue;
    return {
      id: cell.id,
      ...(cell.pageId ? { pageId: cell.pageId } : {}),
      propertyId: cell.propertyId,
      value: value ?? null,
      attachmentId: cell.attachmentId ?? null,
    };
  }

  private findTable(
    document: ProseMirrorJson,
    tableRef: string,
  ): { table: ProseMirrorJson; path: number[] } | null {
    let target: number[];
    try {
      target = getAiPageNodePath(document, tableRef);
    } catch {
      return null;
    }
    let node = document;
    let table: { table: ProseMirrorJson; path: number[] } | null = null;
    for (let index = 0; index < target.length; index++) {
      node = node.content![target[index]];
      if (node.type === 'table')
        table = { table: node, path: target.slice(0, index + 1) };
    }
    return table;
  }

  private encodeCursor(
    tool: string,
    resourceId: string,
    keyset: { sortAt: Date | string; id: string },
  ): string {
    const sortAt = new Date(keyset.sortAt);
    if (!Number.isFinite(sortAt.getTime()) || !keyset.id) {
      throw new Error('Cannot encode an invalid AI tool cursor');
    }
    const payload: AiToolKeysetCursor = {
      version: AI_TOOL_CURSOR_VERSION,
      tool,
      resourceId,
      sortAt: sortAt.toISOString(),
      id: keyset.id,
    };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  private decodeCursor(
    cursor: string | undefined,
    tool: string,
    resourceId: string,
  ): { sortAt: Date; id: string } | null {
    if (!cursor) return null;
    try {
      if (
        cursor.length > AI_TOOL_CURSOR_MAX_LENGTH ||
        !/^[A-Za-z0-9_-]+$/.test(cursor)
      ) {
        throw new Error();
      }
      const value = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Partial<AiToolKeysetCursor>;
      const sortAt = new Date(value.sortAt ?? '');
      if (
        value.version !== AI_TOOL_CURSOR_VERSION ||
        value.tool !== tool ||
        value.resourceId !== resourceId ||
        typeof value.id !== 'string' ||
        value.id.length === 0 ||
        value.id.length > 128 ||
        typeof value.sortAt !== 'string' ||
        !Number.isFinite(sortAt.getTime()) ||
        sortAt.toISOString() !== value.sortAt
      ) {
        throw new Error();
      }
      return { sortAt, id: value.id };
    } catch {
      throw new BadRequestException('Invalid AI tool cursor');
    }
  }

  private async pageCitations(
    page: any,
    document: ProseMirrorJson | undefined,
    context: AiToolExecutionContext,
    preferredNodeId?: string,
  ): Promise<Array<Omit<AiCitationCandidate, 'marker'>>> {
    const space = await this.db
      .selectFrom('spaces')
      .select('slug')
      .where('id', '=', context.spaceId)
      .executeTakeFirst();
    const baseUrl = space
      ? `/s/${encodeURIComponent(space.slug)}/p/${encodeURIComponent(page.slugId)}`
      : null;
    const root: Omit<AiCitationCandidate, 'marker'> = {
      candidateKey: `page:${page.id}:root`,
      sourceType: 'page',
      sourceId: page.id,
      pageId: page.id,
      sourceTitle: page.title?.trim() || 'Untitled',
      sourceUrl: baseUrl,
      excerpt: null,
      relevanceScore: null,
      sectionId: null,
      sectionTitle: null,
      root: true,
    };
    if (!document) return [root];
    const outline = getAiPageOutline(document);
    const stableHeadings = outline.filter(
      (item) =>
        item.type === 'heading' &&
        typeof item.id === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(item.id),
    );
    const idCounts = new Map<string, number>();
    stableHeadings.forEach((item) =>
      idCounts.set(item.id!, (idCounts.get(item.id!) ?? 0) + 1),
    );
    const headings = stableHeadings.filter(
      (item) => idCounts.get(item.id!) === 1,
    );
    const selected = preferredNodeId
      ? headings.filter((item) => item.id === preferredNodeId)
      : headings;
    return [
      root,
      ...selected.slice(0, 300).map((item) => ({
        ...root,
        candidateKey: `page:${page.id}:${item.id}`,
        sourceUrl: baseUrl
          ? `${baseUrl}#${encodeURIComponent(item.id!)}`
          : null,
        excerpt: item.text,
        sectionId: item.id,
        sectionTitle: item.text,
        root: false,
      })),
    ];
  }

  private async pageRootCitations(
    sources: Array<{ pageId: string; type: 'page' | 'database_row' }>,
    context: AiToolExecutionContext,
  ): Promise<Array<Omit<AiCitationCandidate, 'marker'>>> {
    const sourceTypes = new Map(
      sources.map((source) => [source.pageId, source.type] as const),
    );
    const uniquePageIds = [...sourceTypes.keys()].slice(0, 512);
    if (uniquePageIds.length === 0) return [];
    const databaseRowPageIds = uniquePageIds.filter(
      (pageId) => sourceTypes.get(pageId) === 'database_row',
    );
    const [space, pages, databaseRows] = await Promise.all([
      this.db
        .selectFrom('spaces')
        .select('slug')
        .where('id', '=', context.spaceId)
        .executeTakeFirst(),
      this.db
        .selectFrom('pages')
        .select(['id', 'title', 'slugId'])
        .where('workspaceId', '=', context.workspaceId)
        .where('spaceId', '=', context.spaceId)
        .where('deletedAt', 'is', null)
        .where('id', 'in', uniquePageIds)
        .execute(),
      databaseRowPageIds.length
        ? this.db
            .selectFrom('databaseRows')
            .select(['id', 'pageId'])
            .where('workspaceId', '=', context.workspaceId)
            .where('pageId', 'in', databaseRowPageIds)
            .execute()
        : Promise.resolve([]),
    ]);
    const byId = new Map(pages.map((page) => [page.id, page]));
    const rowByPageId = new Map(
      databaseRows.map((row) => [row.pageId, row.id] as const),
    );
    return uniquePageIds.flatMap((pageId) => {
      const page = byId.get(pageId);
      if (!page) return [];
      const sourceType = sourceTypes.get(pageId) ?? 'page';
      const sourceId = rowByPageId.get(pageId) ?? page.id;
      return [
        {
          candidateKey: `${sourceType}:${sourceId}:root`,
          sourceType,
          sourceId,
          pageId: page.id,
          sourceTitle: page.title?.trim() || 'Untitled',
          sourceUrl: space
            ? `/s/${encodeURIComponent(space.slug)}/p/${encodeURIComponent(page.slugId)}`
            : null,
          excerpt: null,
          relevanceScore: null,
          sectionId: null,
          sectionTitle: null,
          root: true,
        },
      ];
    });
  }

  private async proposeWrite(
    operation: AiPageOperation,
    pageId: string,
    context: AiToolExecutionContext,
    outlineContentHash?: string,
  ): Promise<AiToolExecutionResult> {
    if (
      context.source !== 'agent' ||
      !context.currentPageId ||
      pageId !== context.currentPageId
    ) {
      throw new ForbiddenException(
        context.source === 'agent' && context.currentPageId
          ? `Agent writes are limited to the current page. Retry with pageId "${context.currentPageId}" or omit pageId.`
          : 'Agent writes are limited to the current page',
      );
    }
    const page = await this.getReadablePage(pageId, context);
    await this.pageAccess.assertCanWritePage(page, context.user);
    const preparedOperation = prepareAiPageOperation(operation);
    // The approval applies the operation to the live Yjs document, so the
    // proposal must be derived from that same document instead of the
    // periodically persisted `pages.content` snapshot.
    const document = await this.getLivePageContent(pageId, context);
    const baseContentHash = hashProseMirrorJson(document);
    const nodeReference =
      operation.kind === 'insertNode'
        ? operation.anchorNodeId
        : operation.nodeId;
    if (/^#\d+$/.test(nodeReference)) {
      if (
        !outlineContentHash ||
        !/^[a-f0-9]{64}$/.test(outlineContentHash) ||
        outlineContentHash !== baseContentHash
      ) {
        throw new ConflictException({
          code: 'agent_outline_stale',
          message:
            'The page changed after getOutline. Read the outline again before using a #index.',
        });
      }
    }
    const writeProposal = {
      pageId,
      baseContentHash,
      // Hash the representation that the collaboration server will persist.
      expectedAfterHash: hashProseMirrorJson(
        prosemirrorNodeToYJson(
          strictJsonToNode(
            applyAiPageOperation(document, preparedOperation) as JSONContent,
          ),
        ),
      ),
      operation: preparedOperation,
    };
    const approvalPreview = buildAiApprovalPreview(
      document,
      preparedOperation,
      pageId,
      page.title ?? '',
    );
    return {
      content: {
        status: 'pending_user_approval',
        pageId,
        operation: operation.kind,
        approvalPreview,
      },
      writeProposal,
    };
  }

  private async getLivePageContent(
    pageId: string,
    context: AiToolExecutionContext,
    purpose: 'read' | 'write' = 'write',
  ): Promise<ProseMirrorJson> {
    try {
      const content = (await this.collaboration.getPageContent(
        `page.${pageId}`,
        { user: context.user },
      )) as ProseMirrorJson | null;
      if (!content || content.type !== 'doc') {
        throw new Error('invalid live document');
      }
      return content;
    } catch (error) {
      this.logger.error(
        `Failed to read the live document for an AI ${purpose} operation`,
        (error as Error)?.stack,
      );
      throw new ServiceUnavailableException(
        purpose === 'write'
          ? 'The live document is unavailable, so the change cannot be proposed yet'
          : 'The live document is unavailable, so the current page cannot be read yet',
      );
    }
  }

  private async getReadablePage(
    pageId: string,
    context: AiToolExecutionContext,
  ) {
    const page = await this.pages.findById(pageId, true);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== context.workspaceId ||
      page.spaceId !== context.spaceId
    ) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccess.assertCanReadPage(page, context.user);
    if (
      await this.contentPolicy.isPageExcluded(
        pageId,
        context.spaceId,
        context.workspaceId,
      )
    ) {
      throw new ForbiddenException('Page is excluded from AI access');
    }
    return page;
  }

  private async projectPageDocumentFields(
    page: any,
    context: AiToolExecutionContext,
  ) {
    const { id: _pageId, ...metadata } = await this.resolvePageMetadata(
      page,
      context,
    );
    if (readResultFits(metadata, 8 * 1024)) return metadata;
    return {
      ...metadata,
      contributors: metadata.contributors.slice(0, 5),
      labels: metadata.labels.slice(0, 5),
      stakeholders: metadata.stakeholders.slice(0, 5),
      customFields: metadata.customFields
        ? {
            ...metadata.customFields,
            stakeholderIds: metadata.customFields.stakeholderIds?.slice(0, 20),
          }
        : undefined,
      documentFieldsMarkdown: metadata.documentFieldsMarkdown.slice(0, 1000),
      metadataTruncated: true,
      metadataRef: { tool: 'getPageMetadata', pageId: page.id },
    };
  }

  private async resolvePageMetadata(
    page: any,
    context: AiToolExecutionContext,
  ) {
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', context.spaceId)
      .where('workspaceId', '=', context.workspaceId)
      .executeTakeFirstOrThrow();
    const customFields = this.knowledgeProjection.buildCustomFields(
      page.settings,
      this.knowledgeProjection.getDocumentFieldsConfig(space),
    );
    const members = await this.knowledgeProjection.resolveMembers(
      context.workspaceId,
      [customFields],
    );
    const contributorIds = Array.isArray(page.contributorIds)
      ? page.contributorIds.filter((id): id is string => typeof id === 'string')
      : [];
    const ids = [
      ...new Set(
        [
          page.creatorId,
          page.lastUpdatedById,
          ...contributorIds,
          customFields?.assigneeId,
          ...(customFields?.stakeholderIds ?? []),
        ].filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const users = ids.length
      ? await this.db
          .selectFrom('users')
          .select(['id', 'name', 'avatarUrl'])
          .where('workspaceId', '=', context.workspaceId)
          .where('id', 'in', ids)
          .execute()
      : [];
    const actors = new Map(
      users.map((user) => [
        user.id,
        { id: user.id, name: user.name, avatarUrl: user.avatarUrl },
      ]),
    );
    const actor = (id: string | undefined | null) =>
      id
        ? (actors.get(id) ?? {
            id,
            name: members.get(id)?.name ?? null,
            avatarUrl: null,
          })
        : null;
    const [labels, root, row, snapshot, excluded] = await Promise.all([
      this.db
        .selectFrom('labels')
        .innerJoin('pageLabels', 'pageLabels.labelId', 'labels.id')
        .select(['labels.id', 'labels.name', 'labels.type'])
        .where('pageLabels.pageId', '=', page.id)
        .where('labels.workspaceId', '=', context.workspaceId)
        .where('labels.spaceId', '=', context.spaceId)
        .orderBy('labels.id', 'asc')
        .execute(),
      this.db
        .selectFrom('databases')
        .select(['id', 'pageId'])
        .where('pageId', '=', page.id)
        .where('workspaceId', '=', context.workspaceId)
        .where('spaceId', '=', context.spaceId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst(),
      this.db
        .selectFrom('databaseRows')
        .select(['databaseId'])
        .where('pageId', '=', page.id)
        .where('workspaceId', '=', context.workspaceId)
        .where('archivedAt', 'is', null)
        .executeTakeFirst(),
      this.pageAccess.getSidebarAccessSnapshot(context.user, context.spaceId),
      this.contentPolicy.getExcludedPageIds(
        context.spaceId,
        context.workspaceId,
      ),
    ]);
    let databaseId = root?.id ?? null;
    if (!databaseId && row) {
      const database = await this.db
        .selectFrom('databases')
        .select(['id', 'pageId'])
        .where('id', '=', row.databaseId)
        .where('workspaceId', '=', context.workspaceId)
        .where('spaceId', '=', context.spaceId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      if (
        database &&
        snapshot.readablePageIds.has(database.pageId) &&
        !excluded.has(database.pageId)
      )
        databaseId = database.id;
    }
    return {
      id: page.id,
      spaceId: context.spaceId,
      type: root ? 'database' : row ? 'database_row' : 'page',
      databaseId,
      parentPageId:
        page.parentPageId &&
        snapshot.readablePageIds.has(page.parentPageId) &&
        !excluded.has(page.parentPageId)
          ? page.parentPageId
          : null,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      icon: page.icon ?? null,
      isLocked: Boolean(page.isLocked),
      creator: actor(page.creatorId),
      lastUpdatedBy: actor(page.lastUpdatedById),
      contributors: contributorIds.map(actor),
      labels,
      customFields,
      assignee: actor(customFields?.assigneeId),
      stakeholders: (customFields?.stakeholderIds ?? []).map(actor),
      documentFieldsMarkdown: this.knowledgeProjection.renderDocumentFields(
        customFields,
        this.knowledgeProjection.memberNames(members),
      ),
    };
  }

  /**
   * Write tools always target the conversation page. The model does not have
   * to repeat that ID, so an omitted `pageId` resolves to the current page;
   * an explicit value is still checked against it by `proposeWrite`.
   */
  private resolveWritePageId(
    args: Record<string, unknown>,
    context: AiToolExecutionContext,
  ): string {
    if (args.pageId === undefined || args.pageId === null) {
      if (!context.currentPageId) {
        throw new ForbiddenException(
          'Agent writes are limited to the current page',
        );
      }
      return context.currentPageId;
    }
    return this.requireString(args, 'pageId', false, 64);
  }

  private requireString(
    args: Record<string, unknown>,
    key: string,
    allowEmpty = false,
    maxLength?: number,
  ): string {
    const value = args[key];
    if (
      typeof value !== 'string' ||
      (!allowEmpty && value.trim().length === 0) ||
      (maxLength !== undefined && value.length > maxLength)
    ) {
      throw new BadRequestException(`Invalid AI tool argument: ${key}`);
    }
    return value;
  }

  private optionalString(
    args: Record<string, unknown>,
    key: string,
    maxLength?: number,
  ): string | undefined {
    const value = args[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (
      typeof value !== 'string' ||
      (maxLength !== undefined && value.length > maxLength)
    ) {
      throw new BadRequestException(`Invalid AI tool argument: ${key}`);
    }
    return value;
  }

  private requireObject(
    args: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> {
    const value = args[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`Invalid AI tool argument: ${key}`);
    }
    return value as Record<string, unknown>;
  }

  private optionalInteger(
    args: Record<string, unknown>,
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = args[key] ?? fallback;
    if (
      !Number.isInteger(value) ||
      Number(value) < min ||
      Number(value) > max
    ) {
      throw new BadRequestException(`Invalid AI tool argument: ${key}`);
    }
    return Number(value);
  }

  private requireEnum<T extends string>(
    args: Record<string, unknown>,
    key: string,
    values: readonly T[],
  ): T {
    const value = args[key];
    if (typeof value !== 'string' || !values.includes(value as T)) {
      throw new BadRequestException(`Invalid AI tool argument: ${key}`);
    }
    return value as T;
  }
}
