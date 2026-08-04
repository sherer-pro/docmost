import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User } from '@docmost/db/types/entity.types';
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
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import {
  AiPageOperation,
  ProseMirrorJson,
  applyAiPageOperation,
  assertSafeAiPageOperation,
  buildAiApprovalPreview,
  getAiPageNode,
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
import { diffProseMirrorDocuments } from '@docmost/editor-ext';
import { jsonToNode } from '../../../collaboration/collaboration.util';
import { PageTemplatePolicyService } from '../../page/transclusion/page-template-policy.service';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { SpaceRole } from '../../../common/helpers/types/permission';

// Model steps and tool calls are budgeted per approval segment: an approved,
// rejected, or expired write proposal starts a new segment. The run-level
// ceilings still bound the whole attempt.
export const AI_AGENT_MAX_MODEL_STEPS = 8;
export const AI_AGENT_MAX_TOOL_CALLS = 16;
export const AI_AGENT_MAX_RUN_MODEL_STEPS = 32;
export const AI_AGENT_MAX_RUN_TOOL_CALLS = 64;
export const AI_TOOL_RESULT_MAX_BYTES = 32 * 1024;
export const AI_TOOL_RESULTS_TOTAL_MAX_BYTES = 128 * 1024;
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

export type AiToolExposure = 'agent' | 'mcp';
export type AiToolWriteClass = 'read_only' | 'write';

export type AiToolExecutionContext = {
  user: User;
  workspaceId: string;
  spaceId: string;
  currentPageId?: string;
  source: AiToolExposure;
};

export type AiToolWriteProposal = {
  pageId: string;
  baseContentHash: string;
  expectedAfterHash: string;
  operation: AiPageOperation;
};

export type AiToolExecutionResult = {
  content: unknown;
  writeProposal?: AiToolWriteProposal;
  citations?: Array<Omit<AiCitationCandidate, 'marker'>>;
};

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
    private readonly collaboration: CollaborationGateway,
    private readonly shareService: ShareService,
    private readonly environment: EnvironmentService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageTemplatePolicy: PageTemplatePolicyService,
    private readonly spaceMemberRepo: SpaceMemberRepo,
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
        !['workspace', 'current_space', 'readable_page', 'current_page'].includes(
          tool.targetScope,
        ) ||
        !['none', 'current_page_hash'].includes(tool.approvalMode) ||
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
          tool.approvalMode !== 'current_page_hash') ||
        (tool.writeClass === 'write' && tool.targetScope !== 'current_page') ||
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
      throw new BadRequestException(
        'AI tool result exceeds its configured limit',
      );
    }
    return result;
  }

  private createTools(): InternalAiToolDefinition[] {
    return [
      {
        name: 'search',
        description:
          'Search readable pages and database rows in the current space. Returns compact snippets and page IDs.',
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
          'List the readable page tree for the current space without page content.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.tree.read',
        category: 'page_read',
        targetScope: 'current_space',
        ...READ_TOOL_POLICY,
        execute: (_args, context) => this.getTree(context),
      },
      {
        name: 'getPageContext',
        description:
          'Get compact metadata, visible breadcrumbs, and direct readable children for a page.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: { pageId: PAGE_ID_SCHEMA },
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
          ),
      },
      {
        name: 'getPage',
        description:
          'Read a page. Large documents return compact text and outline instead of oversized JSON.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: { pageId: PAGE_ID_SCHEMA },
        },
        writeClass: 'read_only',
        exposures: ['agent', 'mcp'],
        capability: 'page.content.read',
        category: 'page_read',
        targetScope: 'readable_page',
        ...READ_TOOL_POLICY,
        execute: (args, context) =>
          this.getPage(this.requireString(args, 'pageId', false, 64), context),
      },
      {
        name: 'getOutline',
        description:
          'Get stable node IDs, fallback #indexes, nesting levels, types, and compact text for a page.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: { pageId: PAGE_ID_SCHEMA },
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
          ),
      },
      {
        name: 'getNode',
        description:
          'Read one ProseMirror node by its stable ID or by a #index returned from getOutline.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId', 'nodeId'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            nodeId: { type: 'string', minLength: 1, maxLength: 128 },
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
        description:
          'Get curated metadata, schema properties, and compact view metadata for one readable database.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['databaseId'],
          properties: {
            databaseId: { type: 'string', format: 'uuid' },
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
          properties: { pageId: PAGE_ID_SCHEMA },
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
          'List readable marked page templates in the current space without page content.',
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
          'Read safe metadata for one marked template page in the current space.',
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
          'List readable live-embed occurrences for one template. Only consumers in the current scoped space are counted.',
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
          ),
      },
    ];
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
    const items = response.items.map((item) => ({
      pageId: item.id,
      type: (item.databaseId ? 'database_row' : 'page') as
        | 'page'
        | 'database_row',
      databaseId: item.databaseId ?? null,
      title: item.title,
      highlight: item.highlight,
      breadcrumbs: item.breadcrumbs?.map((crumb) => crumb.title) ?? [],
      updatedAt: item.updatedAt,
    }));
    return {
      content: { items },
      citations: await this.pageRootCitations(items, context),
    };
  }

  private async getTree(
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const snapshot = await this.pageAccess.getSidebarAccessSnapshot(
      context.user,
      context.spaceId,
    );
    const excluded = await this.contentPolicy.getExcludedPageIds(
      context.spaceId,
      context.workspaceId,
    );
    const readablePageIds = [...snapshot.readablePageIds].filter(
      (pageId) => !excluded.has(pageId),
    );
    if (readablePageIds.length === 0) {
      return { content: { items: [] } };
    }
    const rows = await this.db
      .selectFrom('pages')
      .select([
        'id',
        'parentPageId',
        'title',
        'slugId',
        'position',
        'updatedAt',
      ])
      .where('workspaceId', '=', context.workspaceId)
      .where('spaceId', '=', context.spaceId)
      .where('deletedAt', 'is', null)
      .where('id', 'in', readablePageIds)
      .orderBy('parentPageId', 'asc')
      .orderBy('position', 'asc')
      .limit(500)
      .execute();
    const content = fitAiToolItems(
      rows.map((row) => ({
        ...row,
        parentPageId:
          row.parentPageId &&
          snapshot.readablePageIds.has(row.parentPageId) &&
          !excluded.has(row.parentPageId)
            ? row.parentPageId
            : null,
      })),
    );
    return {
      content,
      citations: await this.pageRootCitations(
        content.items.map((item: any) => ({ pageId: item.id, type: 'page' })),
        context,
      ),
    };
  }

  private async getPageContext(
    pageId: string,
    context: AiToolExecutionContext,
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
    const readableChildIds = [...snapshot.readablePageIds].filter(
      (childId) => !excluded.has(childId),
    );
    const [breadcrumbs, children] = await Promise.all([
      this.pages.getPageBreadCrumbs(pageId),
      readableChildIds.length === 0
        ? Promise.resolve([])
        : this.db
            .selectFrom('pages')
            .select(['id', 'title', 'slugId', 'position', 'updatedAt'])
            .where('workspaceId', '=', context.workspaceId)
            .where('spaceId', '=', context.spaceId)
            .where('parentPageId', '=', pageId)
            .where('deletedAt', 'is', null)
            .where('id', 'in', readableChildIds)
            .orderBy('position', 'asc')
            .limit(50)
            .execute(),
    ]);
    return {
      content: {
        page: {
          id: page.id,
          title: page.title,
          slugId: page.slugId,
          updatedAt: page.updatedAt,
        },
        breadcrumbs: breadcrumbs
          .filter(
            (item) =>
              snapshot.visiblePageIds.has(item.id) && !excluded.has(item.id),
          )
          .map((item) => ({ id: item.id, title: item.title })),
        children,
      },
      citations: [
        ...(await this.pageCitations(page, undefined, context)),
        ...(await this.pageRootCitations(
          children.map((child) => ({ pageId: child.id, type: 'page' })),
          context,
        )),
      ],
    };
  }

  private async getPage(
    pageId: string,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const document = (page.content ?? { type: 'doc', content: [] }) as
      | ProseMirrorJson
      | undefined;
    const serializedContent = JSON.stringify(document);
    const fits = Buffer.byteLength(serializedContent, 'utf8') <= 24 * 1024;
    return {
      content: {
        id: page.id,
        title: page.title,
        slugId: page.slugId,
        updatedAt: page.updatedAt,
        content: fits ? document : null,
        text: getProseMirrorText(document ?? {}).slice(0, 16000),
        outline: fits
          ? undefined
          : getAiPageOutline(document ?? {}).slice(0, 80),
        truncated: !fits,
      },
      citations: await this.pageCitations(page, document, context),
    };
  }

  private async getOutline(
    pageId: string,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const outline = getAiPageOutline(
      (page.content ?? { type: 'doc', content: [] }) as ProseMirrorJson,
    );
    return {
      content: { pageId, items: outline.slice(0, 300) },
      citations: await this.pageCitations(
        page,
        (page.content ?? { type: 'doc', content: [] }) as ProseMirrorJson,
        context,
      ),
    };
  }

  private async getNode(
    pageId: string,
    nodeId: string,
    context: AiToolExecutionContext,
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const node = getAiPageNode(
      (page.content ?? { type: 'doc', content: [] }) as ProseMirrorJson,
      nodeId,
    );
    return {
      content: { pageId, nodeId, node },
      citations: await this.pageCitations(
        page,
        (page.content ?? { type: 'doc', content: [] }) as ProseMirrorJson,
        context,
        nodeId,
      ),
    };
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
      this.spaceMemberRepo.getUserSpaceRoles(
        context.user.id,
        context.spaceId,
      ),
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
  ): Promise<AiToolExecutionResult> {
    const database = await this.getReadableDatabase(databaseId, context);
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
    return {
      content: {
        database: this.curatedDatabase(database),
        properties: properties.map((property) =>
          this.curatedDatabaseProperty(property),
        ),
        views,
      },
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
      ])
      .where('row.databaseId', '=', database.id)
      .where('row.workspaceId', '=', context.workspaceId)
      .where('row.archivedAt', 'is', null)
      .where('page.workspaceId', '=', context.workspaceId)
      .where('page.spaceId', '=', context.spaceId)
      .where('page.deletedAt', 'is', null);
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
    const snapshot = await this.pageAccess.getSidebarAccessSnapshot(
      context.user,
      context.spaceId,
    );
    const excluded = await this.contentPolicy.getExcludedPageIds(
      context.spaceId,
      context.workspaceId,
    );
    const readableRows = pageRows.filter(
      (row) =>
        snapshot.readablePageIds.has(row.pageId) && !excluded.has(row.pageId),
    );
    const pageIds = readableRows.map((row) => row.pageId);
    const cells = pageIds.length
      ? await this.db
          .selectFrom('databaseCells')
          .select(['id', 'pageId', 'propertyId', 'value', 'attachmentId'])
          .where('databaseId', '=', database.id)
          .where('workspaceId', '=', context.workspaceId)
          .where('pageId', 'in', pageIds)
          .where('deletedAt', 'is', null)
          .execute()
      : [];
    const cellsByPage = new Map<string, typeof cells>();
    for (const cell of cells) {
      const values = cellsByPage.get(cell.pageId) ?? [];
      values.push(this.curatedDatabaseCell(cell) as (typeof cells)[number]);
      cellsByPage.set(cell.pageId, values);
    }
    const items = readableRows.map((row) => ({
      ...row,
      cells: cellsByPage.get(row.pageId) ?? [],
    }));
    const fitted = fitAiToolItems(items, 28 * 1024);
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
      citations: await this.pageRootCitations(
        [
          { pageId: database.pageId, type: 'page' },
          ...fitted.items.map((row) => ({
            pageId: row.pageId,
            type: 'database_row' as const,
          })),
        ],
        context,
      ),
    };
  }

  private async getDatabaseRowContext(
    pageId: string,
    context: AiToolExecutionContext,
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
    const [properties, cells] = await Promise.all([
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
    return {
      content: {
        database: this.curatedDatabase(database),
        row: {
          ...row,
          title: page.title,
          slugId: page.slugId,
          icon: page.icon,
        },
        properties: properties.map((property) =>
          this.curatedDatabaseProperty(property),
        ),
        cells: cells.map((cell) => this.curatedDatabaseCell(cell)),
      },
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
  ): Promise<AiToolExecutionResult> {
    const page = await this.getReadablePage(pageId, context);
    const document = (page.content ?? {
      type: 'doc',
      content: [],
    }) as ProseMirrorJson;
    const resolved = this.findTable(document, tableRef);
    if (!resolved) throw new NotFoundException('Table not found');
    const rows = Array.isArray(resolved.table.content)
      ? resolved.table.content.filter((node) => node?.type === 'tableRow')
      : [];
    const cells = rows.map((row) =>
      (row.content ?? []).map((cell) =>
        getProseMirrorText(cell).slice(0, 2000),
      ),
    );
    const cellIds = rows.map((row) =>
      (row.content ?? []).map((cell) => {
        const paragraph = Array.isArray(cell?.content) ? cell.content[0] : null;
        return typeof paragraph?.attrs?.id === 'string'
          ? paragraph.attrs.id
          : null;
      }),
    );
    const rowItems = cells.map((row, index) => ({
      cells: row,
      cellIds: cellIds[index],
    }));
    const fitted = fitAiToolItems(rowItems, 28 * 1024);
    return {
      content: {
        pageId,
        tableRef,
        path: resolved.path,
        rows: rows.length,
        cols: cells[0]?.length ?? 0,
        cells: fitted.items.map((row) => row.cells),
        cellIds: fitted.items.map((row) => row.cellIds),
        truncated: fitted.truncated,
      },
      citations: await this.pageCitations(page, document, context, tableRef),
    };
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
            ? this.encodeCursor(
                'listTransclusionReferences',
                resourceId,
                {
                  sortAt: cursorRow.updatedAt,
                  id: cursorRow.id,
                },
              )
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
      .where('page.isTemplate', '=', true)
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
    if (!page.isTemplate) throw new NotFoundException('Template not found');
    return {
      content: {
        id: page.id,
        title: page.title,
        slugId: page.slugId,
        icon: page.icon,
        spaceId: page.spaceId,
        updatedAt: page.updatedAt,
        isTemplate: true,
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
    if (!source.isTemplate) throw new NotFoundException('Template not found');
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
            .selectFrom('pageTransclusionReferences as reference')
            .innerJoin('pages as page', 'page.id', 'reference.referencePageId')
            .select([
              'page.id',
              'page.title',
              'page.slugId',
              'page.icon',
              'page.updatedAt',
              'reference.referenceNodeId',
            ])
            .where('reference.workspaceId', '=', context.workspaceId)
            .where('reference.referenceKind', '=', 'page')
            .where('reference.sourcePageId', '=', pageId)
            .where('page.workspaceId', '=', context.workspaceId)
            .where('page.spaceId', '=', context.spaceId)
            .where('page.deletedAt', 'is', null)
            .where('page.id', 'in', readablePageIds)
            .orderBy('page.updatedAt', 'desc')
            .execute();
    const grouped = new Map<
      string,
      (typeof rows)[number] & { occurrenceCount: number }
    >();
    for (const row of rows) {
      const existing = grouped.get(row.id);
      if (existing) existing.occurrenceCount += 1;
      else grouped.set(row.id, { ...row, occurrenceCount: 1 });
    }
    const items = Array.from(grouped.values())
      .slice(0, limit)
      .map(({ referenceNodeId: _referenceNodeId, ...item }) => item);
    const fitted = fitAiToolItems(items, 12 * 1024);
    return {
      content: {
        source: { id: source.id, title: source.title, slugId: source.slugId },
        items: fitted.items,
        occurrenceCount: rows.length,
        truncated: grouped.size > limit || fitted.truncated,
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
      !policy.workspaceEnabled ||
      !policy.templatesEnabled ||
      !policy.allowedActions.some((action) =>
        ['manage_template', 'use_snapshot', 'use_live_embed'].includes(action),
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
      property.type === 'select' &&
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
    const targetIndex = /^#(\d+)$/.exec(tableRef);
    if (targetIndex) {
      const index = Number(targetIndex[1]);
      const node = document.content?.[index];
      if (!node) return null;
      if (node.type === 'table') return { table: node, path: [index] };
      return this.findTableContaining(node, tableRef, [index]);
    }
    return this.findTableContaining(document, tableRef, []);
  }

  private findTableContaining(
    node: ProseMirrorJson,
    tableRef: string,
    path: number[],
  ): { table: ProseMirrorJson; path: number[] } | null {
    if (node.type === 'table') {
      if (this.containsNodeId(node, tableRef)) return { table: node, path };
      return null;
    }
    for (let index = 0; index < (node.content?.length ?? 0); index += 1) {
      const result = this.findTableContaining(node.content![index], tableRef, [
        ...path,
        index,
      ]);
      if (result) return result;
    }
    return null;
  }

  private containsNodeId(node: ProseMirrorJson, nodeId: string): boolean {
    if (node.attrs?.id === nodeId) return true;
    return (node.content ?? []).some((child) =>
      this.containsNodeId(child, nodeId),
    );
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
    const writeProposal = {
      pageId,
      baseContentHash: hashProseMirrorJson(document),
      expectedAfterHash: hashProseMirrorJson(
        applyAiPageOperation(document, preparedOperation),
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
      const content = (await this.collaboration.handleYjsEvent(
        'getAiPageContent',
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
