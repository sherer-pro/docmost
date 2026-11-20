import {
  All,
  Body,
  Controller,
  ConflictException,
  HttpException,
  Optional,
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
import { ApiKeyTrafficGuard } from '../api-key/traffic/api-key-traffic.guard';
import { ApiKeyTraffic } from '../api-key/traffic/api-key-traffic.decorator';
import { ApiKeyTrafficService } from '../api-key/traffic/api-key-traffic.service';
import { AuthMcpPrincipal } from './auth-mcp-principal.decorator';
import { getAppVersion } from '../../common/helpers/get-app-version';
import {
  AiBuiltinToolPolicyService,
  type McpToolPrincipal,
} from '../ai/tools/ai-builtin-tool-policy.service';
import { McpOAuthService } from './oauth/mcp-oauth.service';
import { ApiKeyValidationService } from '../api-key/api-key-validation.service';
import { TokenService } from '../auth/services/token.service';
import { JwtType } from '../auth/dto/jwt-payload';
import { McpWriteService } from './mcp-write.service';
import { isMcpWriteTool } from './mcp-write-contract';

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
    private readonly oauth: McpOAuthService,
    @Optional() private readonly apiKeys?: ApiKeyValidationService,
    @Optional() private readonly tokens?: TokenService,
    @Optional() private readonly writes?: McpWriteService,
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
    @AuthMcpPrincipal() apiKey: McpToolPrincipal,
  ): Promise<void> {
    const allowedTools = await this.toolPolicy.listForMcp(apiKey);
    const server = new Server(
      { name: 'docmost', version: getAppVersion() },
      {
        capabilities: { tools: {} },
        instructions:
          'Access to one authorized Docmost space. API keys can provide selected, version-checked write capabilities. OAuth grants are read-only.',
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
        const actor = await this.revalidateOAuth(request, workspace);
        const principal = actor?.mcpScope ?? apiKey;
        await this.toolPolicy.assertMcpToolAllowed(principal, call.params.name);
        const name = call.params.name;
        const args = call.params.arguments ?? {};
        const editKind = (args.edit as { kind?: unknown } | undefined)?.kind;
        const writesDrawio = name === 'editPageContent' &&
          (editKind === 'replaceDrawio' || editKind === 'appendDrawio');
        if (writesDrawio)
          await this.toolPolicy.assertMcpToolAllowed(
            principal,
            'uploadPageImage',
          );
        let content: unknown;
        if (isMcpWriteTool(name)) {
          if (
            !this.writes ||
            !actor ||
            !('keyType' in principal) ||
            principal.keyType !== 'mcp' ||
            !principal.id
          ) {
            throw new HttpException(
              'MCP write requires an authorized API key',
              403,
            );
          }
          content = await this.writes.execute(name, args, {
            keyId: principal.id,
            user: actor.user,
            space,
            reauthorize: async () => {
              const live = await this.revalidateOAuth(request, workspace);
              if (
                !live ||
                live.mcpScope.id !== principal.id ||
                live.mcpScope.spaceId !== space.id ||
                !('keyType' in live.mcpScope) ||
                live.mcpScope.keyType !== 'mcp' ||
                live.user.id !== user.id
              ) {
                throw new HttpException(
                  'MCP write requires an authorized API key',
                  403,
                );
              }
              await this.toolPolicy.assertMcpToolAllowed(live.mcpScope, name);
              if (writesDrawio)
                await this.toolPolicy.assertMcpToolAllowed(
                  live.mcpScope,
                  'uploadPageImage',
                );
              return live.user;
            },
          });
        } else {
          content = (
            await this.tools.execute(name, args, {
              user: actor?.user ?? user,
              workspaceId: workspace.id,
              spaceId: space.id,
              source: 'mcp',
            })
          ).content;
        }
        const current = await this.revalidateOAuth(request, workspace);
        if (
          actor &&
          current &&
          (actor.user.id !== current.user.id ||
            actor.user.role !== current.user.role)
        )
          throw new ConflictException({
            code: 'MCP_SOURCE_CHANGED',
            message: 'Source access changed; restart reading',
          });
        await this.toolPolicy.assertMcpToolAllowed(
          current?.mcpScope ?? principal,
          call.params.name,
        );
        const text = JSON.stringify(content);
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
          structuredContent: this.safeErrorDetails(error, text),
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

  private async revalidateOAuth(request: FastifyRequest, workspace: Workspace) {
    const token = /^Bearer (\S+)$/i.exec(
      String(request.headers?.authorization ?? ''),
    )?.[1];
    if ((request as any).user?.authType === 'mcp_oauth') {
      if (!token) throw new HttpException('MCP authorization is invalid', 401);
      return this.oauth.authenticate(workspace, token);
    }
    if ((request as any).user?.authType !== 'api_key') return null;
    if (!this.apiKeys || !this.tokens) {
      if ((request as any).user?.authType === 'api_key')
        throw new HttpException('MCP authorization is unavailable', 503);
      return null;
    }
    if (!token) throw new HttpException('MCP authorization is invalid', 401);
    const payload = await this.tokens.verifyJwt(token, JwtType.API_KEY);
    const actor = await this.apiKeys.validateApiKey(payload, 'mcp');
    if (actor.workspace.id !== workspace.id)
      throw new HttpException('MCP authorization is invalid', 401);
    return { user: actor.user, mcpScope: actor.apiKey };
  }

  private safeErrorDetails(error: unknown, message: string) {
    const response =
      error instanceof HttpException ? error.getResponse() : null;
    const code =
      response &&
      typeof response === 'object' &&
      typeof (response as any).code === 'string'
        ? String((response as any).code).slice(0, 64)
        : error instanceof HttpException
          ? `MCP_HTTP_${error.getStatus()}`
          : 'MCP_INTERNAL_ERROR';
    return {
      code,
      message,
      retryable:
        error instanceof HttpException &&
        [409, 429, 503].includes(error.getStatus()),
    };
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
