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
import { AI_MCP_TOOL_NAME_PREFIX } from '../mcp/ai-mcp.constants';

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

export function fitAiToolItems(
  items: unknown[],
  maxBytes = AI_TOOL_RESULT_MAX_BYTES,
): { items: unknown[]; truncated: boolean } {
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
};

export type AiToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  writeClass: AiToolWriteClass;
  exposures: AiToolExposure[];
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
    if (size > AI_TOOL_RESULT_MAX_BYTES) {
      throw new BadRequestException('AI tool result exceeds 32 KiB');
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
        execute: (args, context) =>
          this.searchInPage(
            this.requireString(args, 'pageId', false, 64),
            this.requireString(args, 'query', false, 512),
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
    return {
      content: {
        items: response.items.map((item) => ({
            pageId: item.id,
            type: item.databaseId ? 'database_row' : 'page',
            databaseId: item.databaseId ?? null,
            title: item.title,
            highlight: item.highlight,
            breadcrumbs: item.breadcrumbs?.map((crumb) => crumb.title) ?? [],
            updatedAt: item.updatedAt,
          })),
      },
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
    return {
      content: fitAiToolItems(
        rows.map((row) => ({
            ...row,
            parentPageId:
              row.parentPageId &&
              snapshot.readablePageIds.has(row.parentPageId) &&
              !excluded.has(row.parentPageId)
                ? row.parentPageId
                : null,
          })),
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
    return { content: { pageId, items: outline.slice(0, 300) } };
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
    return { content: { pageId, nodeId, node } };
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
    return { content: { pageId, items } };
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
        'Failed to read the live document for an AI write proposal',
        (error as Error)?.stack,
      );
      throw new ServiceUnavailableException(
        'The live document is unavailable, so the change cannot be proposed yet',
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
