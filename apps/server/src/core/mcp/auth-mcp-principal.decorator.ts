import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { McpToolPrincipal } from '../ai/tools/ai-builtin-tool-policy.service';

export const AuthMcpPrincipal = createParamDecorator(
  (_: unknown, context: ExecutionContext): McpToolPrincipal => {
    const actor = context.switchToHttp().getRequest().user;
    const principal = actor?.apiKey ?? actor?.mcpScope;
    if (!principal) throw new UnauthorizedException();
    return principal;
  },
);
