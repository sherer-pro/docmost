import type { TFunction } from "i18next";
import type {
  AiExternalMcpUnavailableReason,
  AiExternalMcpUserPreference,
} from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";

export const AI_EXTERNAL_MCP_TOOL_NAME_PREFIX = "mcp__";
const AI_EXTERNAL_MCP_TOOL_NAME_MAX_LENGTH = 64;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;
const TAIL_PATTERN = /^([a-z0-9]+(?:_[a-z0-9]+)*)_([0-9a-f]{16})$/;

export type ParsedAiExternalMcpToolName = {
  namespace: string;
  slug: string;
  hash: string;
};

export function parseAiExternalMcpToolName(
  toolName: string,
): ParsedAiExternalMcpToolName | null {
  if (
    !toolName.startsWith(AI_EXTERNAL_MCP_TOOL_NAME_PREFIX) ||
    toolName.length > AI_EXTERNAL_MCP_TOOL_NAME_MAX_LENGTH
  ) {
    return null;
  }

  const rest = toolName.slice(AI_EXTERNAL_MCP_TOOL_NAME_PREFIX.length);
  const separator = rest.indexOf("__");
  if (separator <= 0) {
    return null;
  }

  const namespace = rest.slice(0, separator);
  if (!NAMESPACE_PATTERN.test(namespace)) {
    return null;
  }

  const match = rest.slice(separator + 2).match(TAIL_PATTERN);
  if (!match) {
    return null;
  }

  return { namespace, slug: match[1], hash: match[2] };
}

export type AiExternalMcpGateInput = {
  deploymentEnabled: boolean;
  workspaceEnabled: boolean;
  serverEnabled: boolean;
  bindingEnabled: boolean;
  deniedByGroup: boolean;
};

/**
 * Deterministic order, outermost gate first, so the reason shown to a user names
 * the level that can actually fix it.
 */
export function resolveAiExternalMcpUnavailableReason(
  gate: AiExternalMcpGateInput,
): AiExternalMcpUnavailableReason | null {
  if (!gate.deploymentEnabled) {
    return "deployment";
  }
  if (!gate.workspaceEnabled) {
    return "workspace";
  }
  if (!gate.serverEnabled) {
    return "server";
  }
  if (!gate.bindingEnabled) {
    return "binding";
  }
  if (gate.deniedByGroup) {
    return "group";
  }
  return null;
}

/**
 * Whether the agent may actually call this server for this user.
 *
 * `optedIn` is read strictly: anything other than `true` is treated as no
 * consent, so a missing or undefined preference can never enable outbound
 * sharing.
 */
export function isAiExternalMcpActive(
  preference: Pick<AiExternalMcpUserPreference, "available" | "optedIn">,
): boolean {
  return preference.available === true && preference.optedIn === true;
}

export function countAiExternalMcpOptedIn(
  items: Array<Pick<AiExternalMcpUserPreference, "available" | "optedIn">>,
): number {
  return items.filter((item) => isAiExternalMcpActive(item)).length;
}

/**
 * Consent can always be narrowed. While a run is active, or while another
 * policy gate is closed, the UI blocks new opt-ins but still permits revoking
 * a previously stored opt-in.
 */
export function canChangeAiExternalMcpPreference(
  preference: Pick<AiExternalMcpUserPreference, "available" | "optedIn">,
  revocationOnly: boolean,
): boolean {
  if (preference.optedIn === true) {
    return true;
  }
  return preference.available === true && !revocationOnly;
}

const UNAVAILABLE_REASON_KEYS: Record<AiExternalMcpUnavailableReason, string> = {
  deployment: "ai.externalTools.unavailableDeployment",
  workspace: "ai.externalTools.unavailableWorkspace",
  server: "ai.externalTools.unavailableServer",
  binding: "ai.externalTools.unavailableBinding",
  group: "ai.externalTools.unavailableGroup",
};

export function getAiExternalMcpUnavailableLabel(
  t: TFunction,
  reason: AiExternalMcpUnavailableReason | null,
): string | null {
  return reason ? t(UNAVAILABLE_REASON_KEYS[reason]) : null;
}

export type AiToolStepLabel = {
  label: string;
  external: boolean;
  namespace: string | null;
};

/**
 * Label for one agent step.
 *
 * An external step is described only by its namespace and slug. Remote-authored
 * text is never used here, so a step label cannot become an injection surface.
 */
export function getAiToolStepLabel(
  step: {
    toolName: string;
    toolSource?: string | null;
    toolNamespace?: string | null;
  },
  t: TFunction,
): AiToolStepLabel {
  if (step.toolSource !== "external_mcp") {
    return {
      label: t(`ai.agent.tool.${step.toolName}`, {
        defaultValue: step.toolName,
      }),
      external: false,
      namespace: null,
    };
  }

  const parsed = parseAiExternalMcpToolName(step.toolName);
  if (!parsed) {
    // Fall back to the raw name rather than to any remote description.
    return { label: step.toolName, external: true, namespace: null };
  }

  return {
    label: t("ai.externalTools.stepLabel", {
      namespace: parsed.namespace,
      tool: parsed.slug,
    }),
    external: true,
    namespace: parsed.namespace,
  };
}
