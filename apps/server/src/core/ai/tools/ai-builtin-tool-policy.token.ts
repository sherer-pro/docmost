import type { AiBuiltinToolCapability } from '@docmost/api-contract';

export const AI_BUILTIN_TOOL_POLICY_RESOLVER = Symbol(
  'AI_BUILTIN_TOOL_POLICY_RESOLVER',
);

export interface AiBuiltinToolPolicyResolver {
  getEffectiveCapabilities(
    workspaceId: string,
    spaceId: string,
    exposure: 'agent' | 'mcp',
  ): Promise<AiBuiltinToolCapability[]>;
}
