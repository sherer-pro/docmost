import type {
  AiBuiltinToolCapability,
  AiBuiltinToolSpacePolicyView,
} from "@docmost/api-contract";

export type McpCapabilityPolicyState =
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function getAvailableMcpCapabilities(
  policy: AiBuiltinToolSpacePolicyView | undefined,
): AiBuiltinToolCapability[] {
  if (!policy) return [];
  const mcpCapabilities = new Set(
    policy.catalog
      .filter((tool) => tool.exposures.includes("mcp"))
      .map((tool) => tool.capability),
  );
  return policy.effectiveCapabilities.filter((capability) =>
    mcpCapabilities.has(capability),
  );
}

export function getUnavailableMcpCapabilities(
  allowed: readonly AiBuiltinToolCapability[],
  policy: AiBuiltinToolSpacePolicyView | undefined,
): AiBuiltinToolCapability[] {
  const available = new Set(getAvailableMcpCapabilities(policy));
  return allowed.filter((capability) => !available.has(capability));
}

export function getMcpCapabilityPolicyState(params: {
  policy: AiBuiltinToolSpacePolicyView | undefined;
  loading: boolean;
  error: boolean;
}): McpCapabilityPolicyState {
  if (params.loading) return "loading";
  if (params.error || !params.policy) return "error";
  return getAvailableMcpCapabilities(params.policy).length > 0
    ? "ready"
    : "empty";
}

export function initializeMcpCapabilitySelection(
  selectionsBySpace: Map<string, AiBuiltinToolCapability[]>,
  spaceId: string,
  defaults: readonly AiBuiltinToolCapability[],
): AiBuiltinToolCapability[] {
  const existing = selectionsBySpace.get(spaceId);
  if (existing) return [...existing];
  const selection = [...defaults];
  selectionsBySpace.set(spaceId, selection);
  return [...selection];
}
