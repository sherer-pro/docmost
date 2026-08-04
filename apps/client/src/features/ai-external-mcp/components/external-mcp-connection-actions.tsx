import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import {
  IconCheck,
  IconPlayerPlay,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { resolveAiErrorMessage } from "@/features/ai/utils/ai-policies.ts";
import type {
  AiExternalMcpDiscoverResult,
  AiExternalMcpTestResult,
} from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";

type Props = {
  onTest: () => void;
  onDiscover: () => void;
  testing: boolean;
  discovering: boolean;
  testResult: AiExternalMcpTestResult | null;
  discoverResult: AiExternalMcpDiscoverResult | null;
  /** Test and discover stay usable while only the workspace switch is off. */
  disabled?: boolean;
};

export default function ExternalMcpConnectionActions({
  onTest,
  onDiscover,
  testing,
  discovering,
  testResult,
  discoverResult,
  disabled,
}: Props) {
  const { t, i18n } = useTranslation();

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Button
          variant="default"
          size="compact-sm"
          leftSection={<IconPlayerPlay size={15} />}
          loading={testing}
          onClick={onTest}
          disabled={disabled}
        >
          {t("ai.externalTools.test")}
        </Button>
        <Button
          variant="default"
          size="compact-sm"
          leftSection={<IconSearch size={15} />}
          loading={discovering}
          onClick={onDiscover}
          disabled={disabled}
        >
          {t("ai.externalTools.discover")}
        </Button>
      </Group>

      {testResult && (
        <Alert
          color={testResult.status === "passed" ? "green" : "red"}
          variant="light"
          icon={
            testResult.status === "passed" ? (
              <IconCheck size={16} />
            ) : (
              <IconX size={16} />
            )
          }
        >
          <Stack gap={4}>
            <Text size="sm">
              {testResult.status === "passed"
                ? t("ai.externalTools.testSucceeded", {
                    latency: testResult.latencyMs,
                  })
                : resolveAiErrorMessage(t, i18n, testResult.errorCode)}
            </Text>
            {testResult.status === "passed" && testResult.protocolVersion && (
              <Text size="xs" c="dimmed">
                {t("ai.externalTools.protocolVersion")}:{" "}
                {testResult.protocolVersion}
              </Text>
            )}
            {/* Remote-reported identity, shown as plain text outside the title. */}
            {testResult.serverName && (
              <Text size="xs" c="dimmed">
                {t("ai.externalTools.remoteIdentity")}: {testResult.serverName}
                {testResult.serverVersion ? ` ${testResult.serverVersion}` : ""}
              </Text>
            )}
          </Stack>
        </Alert>
      )}

      {discoverResult && (
        <Alert
          color={discoverResult.snapshot ? "green" : "red"}
          variant="light"
        >
          <Text size="sm">
            {discoverResult.snapshot
              ? t("ai.externalTools.discoverSucceeded", {
                  count: discoverResult.snapshot.toolCount,
                })
              : resolveAiErrorMessage(t, i18n, discoverResult.errorCode)}
          </Text>
        </Alert>
      )}
    </Stack>
  );
}
