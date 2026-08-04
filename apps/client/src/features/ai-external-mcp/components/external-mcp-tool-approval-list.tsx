import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@mantine/core";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import CopyTextButton from "@/components/common/copy.tsx";
import type {
  AiExternalMcpApprovedTool,
  AiExternalMcpDiscoveredTool,
} from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";

export const AI_EXTERNAL_MCP_MODEL_DESCRIPTION_MAX_LENGTH = 500;

export type ToolApprovalDraft = {
  approved: boolean;
  description: string;
};

type Props = {
  tools: AiExternalMcpDiscoveredTool[];
  approved: AiExternalMcpApprovedTool[];
  drafts: Record<string, ToolApprovalDraft>;
  onChange: (remoteName: string, draft: ToolApprovalDraft) => void;
  disabled?: boolean;
};

/**
 * Approval UI for discovered tools.
 *
 * Two rules drive the layout: remote-authored text is rendered as plain,
 * visually quarantined text and never through a markdown path, and the only
 * model-facing description is the one the administrator types here.
 */
export default function ExternalMcpToolApprovalList({
  tools,
  approved,
  drafts,
  onChange,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const approvedByRemoteName = new Map(
    approved.map((tool) => [tool.remoteName, tool] as const),
  );

  return (
    <Stack gap="sm">
      <div>
        <Text fw={600}>{t("ai.externalTools.approvalTitle")}</Text>
        <Text size="sm" c="dimmed">
          {t("ai.externalTools.approvalDescription")}
        </Text>
      </div>

      {tools.map((tool) => {
        const draft = drafts[tool.remoteName] ?? {
          approved: tool.approved,
          description:
            approvedByRemoteName.get(tool.remoteName)?.description ?? "",
        };
        const descriptionMissing =
          draft.approved && draft.description.trim().length === 0;

        return (
          <Paper key={tool.remoteName} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Group gap="xs" wrap="nowrap">
                  <Switch
                    checked={draft.approved}
                    onChange={(event) =>
                      onChange(tool.remoteName, {
                        ...draft,
                        approved: event.currentTarget.checked,
                      })
                    }
                    label={t("ai.externalTools.approve")}
                    disabled={disabled || !tool.approvable}
                  />
                  <Text size="sm" ff="monospace">
                    {tool.toolName}
                  </Text>
                  <CopyTextButton text={tool.toolName} />
                </Group>
                <Group gap="xs">
                  <Badge color="green" variant="light">
                    {t("ai.externalTools.readOnlyBadge")}
                  </Badge>
                  {tool.approved && (
                    <Badge
                      color="blue"
                      variant="light"
                      leftSection={<IconCheck size={12} />}
                    >
                      {t("ai.externalTools.approvedBadge")}
                    </Badge>
                  )}
                </Group>
              </Group>

              {!tool.approvable && (
                <Alert color="orange" variant="light">
                  {t("ai.externalTools.notApprovableBody")}
                </Alert>
              )}

              {tool.changedSinceApproval && (
                <Alert
                  color="orange"
                  variant="light"
                  icon={<IconAlertTriangle size={16} />}
                  title={t("ai.externalTools.driftTitle")}
                >
                  {t("ai.externalTools.driftBody")}
                </Alert>
              )}

              {/* Remote-reported metadata, visually quarantined. Rendered as
                  plain text only: never markdown, never HTML. */}
              <Alert
                color="gray"
                variant="light"
                icon={<IconAlertTriangle size={16} />}
                title={t("ai.externalTools.untrustedHintsTitle")}
              >
                <Stack gap={6}>
                  <Text size="xs">
                    {t("ai.externalTools.remoteName")}:{" "}
                    <Text span ff="monospace" size="xs">
                      {tool.remoteName}
                    </Text>
                  </Text>

                  {tool.remoteDescriptionPresent || tool.remoteTitlePresent ? (
                    <Text size="xs" c="dimmed">
                      {t("ai.externalTools.remoteProsePresent")}
                    </Text>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t("ai.externalTools.remoteProseAbsent")}
                    </Text>
                  )}

                  {tool.remoteAnnotations && (
                    <Group gap={6}>
                      {tool.remoteAnnotations.readOnlyHint === true && (
                        <Badge size="xs" variant="outline" color="gray">
                          {t("ai.externalTools.claimsReadOnly")}
                        </Badge>
                      )}
                      {tool.remoteAnnotations.destructiveHint === true && (
                        <Badge size="xs" variant="outline" color="gray">
                          {t("ai.externalTools.claimsDestructive")}
                        </Badge>
                      )}
                      {tool.remoteAnnotations.idempotentHint === true && (
                        <Badge size="xs" variant="outline" color="gray">
                          {t("ai.externalTools.claimsIdempotent")}
                        </Badge>
                      )}
                      {tool.remoteAnnotations.openWorldHint === true && (
                        <Badge size="xs" variant="outline" color="gray">
                          {t("ai.externalTools.claimsOpenWorld")}
                        </Badge>
                      )}
                    </Group>
                  )}

                  <Text size="xs" c="dimmed">
                    {t("ai.externalTools.untrustedHintsNotice")}
                  </Text>
                </Stack>
              </Alert>

              {tool.inputSchemaSummary && (
                <div>
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [tool.remoteName]: !current[tool.remoteName],
                      }))
                    }
                  >
                    {t("ai.externalTools.inputFields")}
                  </Button>
                  <Collapse in={Boolean(expanded[tool.remoteName])}>
                    <Group gap={6} mt={6}>
                      {tool.inputSchemaSummary.propertyNames.map((name) => (
                        <Badge
                          key={name}
                          size="xs"
                          variant="light"
                          color={
                            tool.inputSchemaSummary?.requiredNames.includes(name)
                              ? "blue"
                              : "gray"
                          }
                        >
                          {name}
                        </Badge>
                      ))}
                    </Group>
                  </Collapse>
                </div>
              )}

              <Textarea
                label={t("ai.externalTools.modelDescription")}
                description={t("ai.externalTools.modelDescriptionHint")}
                value={draft.description}
                onChange={(event) =>
                  onChange(tool.remoteName, {
                    ...draft,
                    description: event.currentTarget.value,
                  })
                }
                error={
                  descriptionMissing
                    ? t("ai.externalTools.modelDescriptionRequired")
                    : undefined
                }
                maxLength={AI_EXTERNAL_MCP_MODEL_DESCRIPTION_MAX_LENGTH}
                autosize
                minRows={2}
                disabled={disabled || !tool.approvable}
              />
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
