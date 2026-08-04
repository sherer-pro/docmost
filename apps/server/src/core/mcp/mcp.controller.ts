import {
  All,
  Body,
  Controller,
  HttpException,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ApiKey, User, Workspace, Space } from '@docmost/db/types/entity.types';
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthSpace } from '../../common/decorators/auth-space.decorator';
import { AiToolRegistryService } from '../ai/tools/ai-tool-registry.service';
import { McpApiKeyAuthGuard } from './mcp-api-key-auth.guard';
import { ApiKeyTrafficGuard } from '../api-key/traffic/api-key-traffic.guard';
import { ApiKeyTraffic } from '../api-key/traffic/api-key-traffic.decorator';
import { ApiKeyTrafficService } from '../api-key/traffic/api-key-traffic.service';
import { AuthApiKey } from '../../common/decorators/auth-api-key.decorator';
import { AiBuiltinToolPolicyService } from '../ai/tools/ai-builtin-tool-policy.service';

/*
 * The shared tool-registry approach and Streamable HTTP adapter were adapted
 * from vvzvlad/gitmost and vvzvlad/docmost-mcp. See THIRD_PARTY_NOTICES.md
 * for the source revisions and applicable license notices.
 */
@Controller('mcp')
@ApiKeyTraffic('mcp')
@UseGuards(McpApiKeyAuthGuard, ApiKeyTrafficGuard)
export class McpController {
  constructor(
    private readonly tools: AiToolRegistryService,
    private readonly traffic: ApiKeyTrafficService,
    private readonly toolPolicy: AiBuiltinToolPolicyService,
  ) {}

  @All()
  @CsrfExempt()
  @SkipTransform()
  async handle(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @AuthSpace() space: Space,
    @AuthApiKey() apiKey: ApiKey,
  ): Promise<void> {
    const allowedTools = await this.toolPolicy.listForMcp(apiKey);
    const server = new Server(
      { name: 'docmost', version: '1.0.0' },
      {
        capabilities: { tools: {} },
        instructions:
          'Read-only access to the single Docmost space scoped by the MCP API key.',
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allowedTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
        annotations: {
          readOnlyHint: tool.writeClass === 'read_only',
          destructiveHint: tool.annotations.destructive,
          idempotentHint: tool.annotations.idempotent,
          openWorldHint: tool.annotations.openWorld,
        },
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      const startedAt = Date.now();
      try {
        await this.toolPolicy.assertMcpToolAllowed(apiKey, call.params.name);
        const result = await this.tools.execute(
          call.params.name,
          call.params.arguments ?? {},
          {
            user,
            workspaceId: workspace.id,
            spaceId: space.id,
            source: 'mcp',
          },
        );
        const text = JSON.stringify(result.content);
        this.traffic.observeMcpTool(
          'success',
          Date.now() - startedAt,
          Buffer.byteLength(text),
        );
        return {
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
        };
      } catch (error) {
        const text = this.safeError(error);
        this.traffic.observeMcpTool(
          'error',
          Date.now() - startedAt,
          Buffer.byteLength(text),
        );
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
        };
      }
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, body);
    } finally {
      await server.close().catch(() => undefined);
    }
  }

  private safeError(error: unknown): string {
    if (!(error instanceof HttpException)) {
      return 'MCP tool call failed';
    }
    const response = error.getResponse();
    const message =
      typeof response === 'string'
        ? response
        : Array.isArray((response as any)?.message)
          ? (response as any).message.join(', ')
          : ((response as any)?.message ?? 'MCP tool call failed');
    return String(message).slice(0, 500);
  }
}
