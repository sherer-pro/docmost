import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page-access/page-access.service';
import { SearchService } from '../../search/search.service';
import { AiContentPolicyService } from '../../ai-content-policy/ai-content-policy.service';
import { PageService } from '../../page/services/page.service';
import {
  AiPageOperation,
  ProseMirrorJson,
  assertSafeAiPageOperation,
  buildAiApprovalPreview,
  getAiPageNode,
  getAiPageOutline,
  getProseMirrorText,
  hashProseMirrorJson,
} from '../../../common/helpers/prosemirror/ai-page-operation';

export const AI_AGENT_MAX_MODEL_STEPS = 8;
export const AI_AGENT_MAX_TOOL_CALLS = 16;
export const AI_TOOL_RESULT_MAX_BYTES = 32 * 1024;
export const AI_TOOL_RESULTS_TOTAL_MAX_BYTES = 128 * 1024;
export const AI_WRITE_PROPOSAL_TTL_MS = 60 * 60 * 1000;

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

@Injectable()
export class AiToolRegistryService {
  private readonly tools: InternalAiToolDefinition[];

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageAccess: PageAccessService,
    private readonly search: SearchService,
    private readonly contentPolicy: AiContentPolicyService,
    private readonly pages: PageService,
  ) {
    this.tools = this.createTools();
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
          'Propose one exact text replacement in a node on the current page. Requires user approval.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId', 'nodeId', 'oldText', 'newText'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            nodeId: { type: 'string', minLength: 1, maxLength: 128 },
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
            this.requireString(args, 'pageId', false, 64),
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
          required: ['pageId', 'nodeId', 'node'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            nodeId: { type: 'string', minLength: 1, maxLength: 128 },
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
            this.requireString(args, 'pageId', false, 64),
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
          required: ['pageId', 'anchorNodeId', 'position', 'node'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            anchorNodeId: { type: 'string', minLength: 1, maxLength: 128 },
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
            this.requireString(args, 'pageId', false, 64),
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
          required: ['pageId', 'nodeId'],
          properties: {
            pageId: PAGE_ID_SCHEMA,
            nodeId: { type: 'string', minLength: 1, maxLength: 128 },
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
            this.requireString(args, 'pageId', false, 64),
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
      { userId: context.user.id, workspaceId: context.workspaceId },
    );
    return {
      content: {
        items: response.items
          .filter((item) => !excluded.has(item.id))
          .map((item) => ({
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
      .orderBy('parentPageId', 'asc')
      .orderBy('position', 'asc')
      .limit(500)
      .execute();
    return {
      content: {
        items: rows
          .filter(
            (row) =>
              snapshot.readablePageIds.has(row.id) && !excluded.has(row.id),
          )
          .map((row) => ({
            ...row,
            parentPageId:
              row.parentPageId &&
              snapshot.readablePageIds.has(row.parentPageId) &&
              !excluded.has(row.parentPageId)
                ? row.parentPageId
                : null,
          })),
      },
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
    const [breadcrumbs, children] = await Promise.all([
      this.pages.getPageBreadCrumbs(pageId),
      this.db
        .selectFrom('pages')
        .select(['id', 'title', 'slugId', 'position', 'updatedAt'])
        .where('parentPageId', '=', pageId)
        .where('deletedAt', 'is', null)
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
        children: children.filter(
          (item) =>
            snapshot.readablePageIds.has(item.id) && !excluded.has(item.id),
        ),
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
        'Agent writes are limited to the current page',
      );
    }
    const page = await this.getReadablePage(pageId, context);
    await this.pageAccess.assertCanWritePage(page, context.user);
    assertSafeAiPageOperation(operation);
    const document = (page.content ?? {
      type: 'doc',
      content: [],
    }) as ProseMirrorJson;
    const writeProposal = {
      pageId,
      baseContentHash: hashProseMirrorJson(document),
      operation,
    };
    const approvalPreview = buildAiApprovalPreview(
      document,
      operation,
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
