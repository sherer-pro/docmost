import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModalBackgroundInert } from "@/components/ui/use-modal-background-inert";
import { ICreatedApiKey, type McpClientPreset } from "@/features/api-key";
import CopyTextButton from "@/components/common/copy.tsx";
import { getAppUrl, getServerAppUrl } from "@/lib/config.ts";
import {
  buildDocmostMcpPresets,
  getDocmostMcpEndpoint,
} from "@/features/api-key/utils/mcp-presets.ts";
import { useGetApiKeysQuery } from "@/features/api-key/queries/api-key-query.ts";

interface ApiKeyCreatedModalProps {
  opened: boolean;
  onClose: () => void;
  apiKey: ICreatedApiKey | null;
  preferredClient?: McpClientPreset;
}

export function ApiKeyCreatedModal({
  opened,
  onClose,
  apiKey,
  preferredClient = "universal",
}: ApiKeyCreatedModalProps) {
  useModalBackgroundInert(opened && Boolean(apiKey));
  const { t, i18n } = useTranslation();
  const [client, setClient] = useState<McpClientPreset>(preferredClient);
  const isMcp = apiKey?.keyType === "mcp";
  const keys = useGetApiKeysQuery(
    { adminView: true, keyType: "mcp", limit: 100 },
    {
      enabled: opened && isMcp,
      refetchInterval: opened && isMcp ? 3000 : false,
    },
  );

  useEffect(() => {
    if (opened) setClient(preferredClient);
  }, [opened, preferredClient]);

  if (!apiKey) return null;

  const endpoint = getDocmostMcpEndpoint(getServerAppUrl() || getAppUrl());
  const presets = buildDocmostMcpPresets(endpoint, apiKey.token);
  const currentKey =
    keys.data?.items.find((item) => item.id === apiKey.id) ?? apiKey;
  const connected = Boolean(currentKey.lastUsedAt);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("apiKeys.createdTitle")}
      size="xl"
      closeButtonProps={{ "aria-label": t("Close") }}
    >
      <Stack gap="md">
        <Alert
          icon={<IconAlertTriangle size={18} />}
          title={t("apiKeys.oneTimeTitle")}
          color="red"
        >
          {t("apiKeys.oneTimeDescription")}
        </Alert>

        <TokenField label={t("API key")} value={apiKey.token} />

        {isMcp ? (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Metadata label={t("apiKeys.endpoint")} value={endpoint} />
              <Metadata
                label={t("apiKeys.transport")}
                value="Streamable HTTP"
              />
              <Metadata label={t("apiKeys.authentication")} value="Bearer" />
              <Metadata
                label={t("Space")}
                value={apiKey.space?.name || apiKey.spaceId}
              />
              <Metadata
                label={t("apiKeys.permissions")}
                value={t("MCP read-only")}
              />
              <Metadata
                label={t("Expires")}
                value={
                  apiKey.expiresAt
                    ? new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: "medium",
                      }).format(new Date(apiKey.expiresAt))
                    : t("apiKeys.expiresIn365Days")
                }
              />
            </SimpleGrid>

            <Paper withBorder radius="md" p="sm">
              <Group justify="space-between" wrap="wrap">
                <Group gap="xs">
                  {connected ? (
                    <IconCheck size={18} color="var(--mantine-color-green-6)" />
                  ) : (
                    <IconPlugConnected
                      size={18}
                      color="var(--mantine-color-blue-6)"
                    />
                  )}
                  <div>
                    <Text size="sm" fw={600}>
                      {connected
                        ? t("apiKeys.connectionDetected")
                        : t("apiKeys.waitingForConnection")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {connected && currentKey.lastUsedAt
                        ? t("apiKeys.lastConnectedAt", {
                            date: new Intl.DateTimeFormat(i18n.language, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(currentKey.lastUsedAt)),
                          })
                        : t("apiKeys.connectionHint")}
                    </Text>
                  </div>
                </Group>
                <Badge color={connected ? "green" : "blue"} variant="light">
                  {connected ? t("apiKeys.connected") : t("apiKeys.checking")}
                </Badge>
              </Group>
            </Paper>

            <Tabs
              value={client}
              onChange={(value) =>
                setClient((value as McpClientPreset) || "universal")
              }
              keepMounted={false}
            >
              <Tabs.List>
                <Tabs.Tab value="universal">
                  {t("apiKeys.universalClient")}
                </Tabs.Tab>
                <Tabs.Tab value="codex">Codex</Tabs.Tab>
                <Tabs.Tab value="vscode">VS Code</Tabs.Tab>
                <Tabs.Tab value="claude">Claude Desktop</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="universal" pt="md">
                <Stack gap="sm">
                  <Text size="sm">{t("apiKeys.universalInstructions")}</Text>
                  <TokenField label={t("apiKeys.endpoint")} value={endpoint} />
                  <Text size="xs" c="dimmed">
                    {t("apiKeys.bearerInstruction")}
                  </Text>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="codex" pt="md">
                <PresetBlock
                  title={t("apiKeys.codexConfigTitle")}
                  description={t("apiKeys.codexDescription")}
                  value={presets.codex}
                />
                <TokenField
                  label="DOCMOST_MCP_TOKEN"
                  value={apiKey.token}
                  secret
                />
              </Tabs.Panel>

              <Tabs.Panel value="vscode" pt="md">
                <PresetBlock
                  title="mcp.json"
                  description={t("apiKeys.vscodeDescription")}
                  value={presets.vscode}
                />
              </Tabs.Panel>

              <Tabs.Panel value="claude" pt="md">
                <Alert
                  color="orange"
                  icon={<IconAlertTriangle size={18} />}
                  mb="sm"
                >
                  {t("apiKeys.claudeWarning")}
                </Alert>
                <PresetBlock
                  title="claude_desktop_config.json"
                  description={t("apiKeys.claudeDescription")}
                  value={presets.claude}
                />
              </Tabs.Panel>
            </Tabs>
          </>
        ) : (
          <Alert color="blue" title={t("apiKeys.ragCreatedTitle")}>
            {t("apiKeys.ragCreatedDescription")}
          </Alert>
        )}

        <Button fullWidth onClick={onClose} mt="sm">
          {t("apiKeys.savedToken")}
        </Button>
      </Stack>
    </Modal>
  );
}

function TokenField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  return (
    <div>
      <Text size="sm" fw={500} mb={4}>
        {label}
      </Text>
      <Group gap="xs" wrap="nowrap">
        <TextInput
          aria-label={label}
          variant="filled"
          flex={1}
          value={value}
          type={secret ? "password" : "text"}
          readOnly
        />
        <CopyTextButton text={value} />
      </Group>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={600} truncate title={value}>
        {value}
      </Text>
    </Paper>
  );
}

function PresetBlock({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <Stack gap="xs" mb="md">
      <div>
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      </div>
      <Box pos="relative">
        <Code block mah={320} style={{ overflow: "auto", whiteSpace: "pre" }}>
          {value}
        </Code>
        <Box pos="absolute" top={6} right={6}>
          <CopyTextButton text={value} />
        </Box>
      </Box>
    </Stack>
  );
}
