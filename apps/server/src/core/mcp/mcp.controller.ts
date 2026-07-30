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
import { User, Workspace, Space } from '@docmost/db/types/entity.types';
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthSpace } from '../../common/decorators/auth-space.decorator';
import { AiToolRegistryService } from '../ai/tools/ai-tool-registry.service';
import { McpApiKeyAuthGuard } from './mcp-api-key-auth.guard';

/*
 * The shared tool-registry approach and Streamable HTTP adapter were adapted
 * from vvzvlad/gitmost and vvzvlad/docmost-mcp. See THIRD_PARTY_NOTICES.md
 * for the source revisions and applicable license notices.
 */
@Controller('mcp')
@UseGuards(McpApiKeyAuthGuard)
export class McpController {
  constructor(private readonly tools: AiToolRegistryService) {}

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
  ): Promise<void> {
    const server = new Server(
      { name: 'docmost', version: '1.0.0' },
      {
        capabilities: { tools: {} },
        instructions:
          'Read-only access to the single Docmost space scoped by the MCP API key.',
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools.list('mcp').map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      try {
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
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result.content),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: this.safeError(error),
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
          : (response as any)?.message ?? 'MCP tool call failed';
    return String(message).slice(0, 500);
  }
}
