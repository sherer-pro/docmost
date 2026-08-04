import { Injectable } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  AiOutboundUrlPolicy,
  AiOutboundUrlPolicyService,
  AiResolvedOutboundUrl,
} from './ai-outbound-url-policy.service';

/**
 * Outbound URL policy for external MCP servers.
 *
 * Stricter than the provider and retrieval policies in three ways:
 *
 * - `requireExplicitOrigin` removes the development escape hatch, so an origin
 *   is rejected unless the deployment allowlist names it. Loopback therefore
 *   never works implicitly, only through the same dual approval as any other
 *   origin, which is also what makes private ranges reachable exactly when an
 *   operator and a workspace administrator both allow them.
 * - `secondaryAllowedOrigins` requires the workspace allowlist to name the
 *   origin as well. A workspace administrator can only narrow the deployment
 *   allowlist, never widen it.
 * - `denyLoopback` is enabled outside development, so a production deployment
 *   cannot reach a loopback address even by listing one in both allowlists.
 *
 * `allowQuery: false` also rejects URL credentials, query strings, and
 * fragments. `trimTrailingSlash` stays off because an MCP endpoint may
 * distinguish `/mcp` from `/mcp/`.
 */
@Injectable()
export class AiMcpUrlPolicyService {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly outboundPolicy: AiOutboundUrlPolicyService,
  ) {}

  async resolveAllowedForWorkspace(
    rawUrl: string,
    workspaceAllowedOrigins: string,
  ): Promise<AiResolvedOutboundUrl> {
    return this.outboundPolicy.resolveAllowed(
      rawUrl,
      this.policy(workspaceAllowedOrigins),
    );
  }

  async assertAllowedForWorkspace(
    rawUrl: string,
    workspaceAllowedOrigins: string,
  ): Promise<URL> {
    return this.outboundPolicy.assertAllowed(
      rawUrl,
      this.policy(workspaceAllowedOrigins),
    );
  }

  private policy(workspaceAllowedOrigins: string): AiOutboundUrlPolicy {
    return {
      kind: 'mcp',
      allowedOrigins: this.environmentService.getAiMcpAllowedOrigins(),
      secondaryAllowedOrigins: workspaceAllowedOrigins,
      secondaryAllowlistLabel: 'the workspace external MCP allowlist',
      allowQuery: false,
      trimTrailingSlash: false,
      requireExplicitOrigin: true,
      denyLoopback: !this.environmentService.isDevelopment(),
    };
  }
}
