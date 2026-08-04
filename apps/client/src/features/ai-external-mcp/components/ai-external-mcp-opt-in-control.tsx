import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  Popover,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { IconAlertTriangle, IconWorld } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import {
  useAiExternalMcpPreferencesQuery,
  usePutAiExternalMcpPreferencesMutation,
} from "@/features/ai-external-mcp/queries/ai-external-mcp-query.ts";
import {
  countAiExternalMcpOptedIn,
  getAiExternalMcpUnavailableLabel,
  isAiExternalMcpActive,
} from "@/features/ai-external-mcp/utils/ai-external-mcp-policies.ts";

type Props = {
  spaceId: string;
  disabled?: boolean;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Per-user consent for outbound data sharing.
 *
 * The warning is always visible above the switches rather than behind a
 * disclosure: informed consent is the entire purpose of this control.
 */
export default function AiExternalMcpOptInControl({
  spaceId,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const preferencesQuery = useAiExternalMcpPreferencesQuery(spaceId);
  const putPreferences = usePutAiExternalMcpPreferencesMutation(spaceId);

  const items = preferencesQuery.data?.items ?? [];
  const optedInCount = countAiExternalMcpOptedIn(items);
  const availableCount = items.filter((item) => item.available).length;

  if (items.length === 0) {
    return null;
  }

  const toggle = (serverId: string, optedIn: boolean) => {
    // The endpoint replaces the whole set, so every item is sent every time.
    const next = items.map((item) => ({
      serverId: item.serverId,
      optedIn: item.serverId === serverId ? optedIn : item.optedIn,
    }));

    putPreferences.mutate(
      { items: next },
      {
        onError: () => {
          notifications.show({
            color: "red",
            message: t("ai.externalTools.preferenceSaveFailed"),
          });
          void preferencesQuery.refetch();
        },
      },
    );
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="top-end"
      withinPortal
      width={360}
      shadow="md"
    >
      <Popover.Target>
        <Button
          variant={optedInCount > 0 ? "light" : "subtle"}
          size="compact-sm"
          leftSection={<IconWorld size={15} />}
          onClick={() => setOpened((current) => !current)}
          aria-expanded={opened}
          aria-label={t("ai.externalTools.composerToggle")}
          disabled={disabled}
        >
          <Group gap={6} wrap="nowrap">
            <Text size="xs">{t("ai.externalTools.composerToggle")}</Text>
            <Badge size="xs" variant="filled" color="gray">
              {optedInCount}/{availableCount}
            </Badge>
          </Group>
        </Button>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            {t("ai.externalTools.composerTitle")}
          </Text>

          <Alert
            color="orange"
            variant="light"
            icon={<IconAlertTriangle size={16} />}
            title={t("ai.externalTools.consentTitle")}
          >
            <Stack gap={6}>
              <Text size="xs">
                {t("ai.externalTools.consentBody", {
                  host: items.map((item) => hostOf(item.url)).join(", "),
                })}
              </Text>
              <Text size="xs">{t("ai.externalTools.consentScopeNote")}</Text>
              <Text size="xs">{t("ai.externalTools.consentReadOnlyNote")}</Text>
            </Stack>
          </Alert>

          <Stack gap="xs">
            {items.map((item) => {
              const unavailableLabel = getAiExternalMcpUnavailableLabel(
                t,
                item.unavailableReason,
              );

              return (
                <Stack key={item.serverId} gap={2}>
                  <Switch
                    checked={isAiExternalMcpActive(item)}
                    onChange={(event) =>
                      toggle(item.serverId, event.currentTarget.checked)
                    }
                    label={t("ai.externalTools.optInSwitch", {
                      name: item.serverName,
                    })}
                    description={`${hostOf(item.url)} · ${t(
                      "ai.externalTools.optInToolCount",
                      { count: item.toolNames.length },
                    )}`}
                    disabled={
                      !item.available || disabled || putPreferences.isPending
                    }
                  />
                  {unavailableLabel && (
                    <Badge color="gray" variant="light" size="xs" ml={38}>
                      {unavailableLabel}
                    </Badge>
                  )}
                  {item.toolNames.length > 0 && (
                    <div style={{ marginLeft: 38 }}>
                      <Button
                        variant="subtle"
                        size="compact-xs"
                        onClick={() =>
                          setExpanded((current) => ({
                            ...current,
                            [item.serverId]: !current[item.serverId],
                          }))
                        }
                      >
                        {t("ai.externalTools.inputFields")}
                      </Button>
                      <Collapse in={Boolean(expanded[item.serverId])}>
                        <Stack gap={2} mt={4}>
                          {item.toolNames.map((toolName) => (
                            <Text key={toolName} size="xs" ff="monospace" c="dimmed">
                              {toolName}
                            </Text>
                          ))}
                        </Stack>
                      </Collapse>
                    </div>
                  )}
                </Stack>
              );
            })}
          </Stack>

          <Text size="xs" c="dimmed">
            {t("ai.externalTools.optedOutDefault")}
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
