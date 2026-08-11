import type {
  AiBuiltinToolCapability,
  AiBuiltinToolCatalogEntry,
  AiQuickCommand,
} from "@docmost/api-contract";

export function buildAiAssistantProfileCapabilityOptions(
  catalog: readonly AiBuiltinToolCatalogEntry[],
  effectiveCapabilities: readonly AiBuiltinToolCapability[],
  getToolLabel: (toolName: string) => string,
) {
  const effective = new Set(effectiveCapabilities);
  return catalog
    .filter((entry) => effective.has(entry.capability))
    .map((entry) => ({
      value: entry.capability,
      label: getToolLabel(entry.name),
    }));
}

export function normalizeAiAssistantProfileQuickCommands(
  commands: readonly AiQuickCommand[],
): AiQuickCommand[] {
  return commands.map((command, position) => ({
    ...command,
    id: command.id || crypto.randomUUID(),
    enabled: command.enabled !== false,
    position,
  }));
}
