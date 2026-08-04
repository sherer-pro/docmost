import { useId } from "react";
import {
  Badge,
  Button,
  Group,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { useTranslation } from "react-i18next";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import {
  createAiExternalMcpHeaderRow,
  type AiExternalMcpHeaderDraft,
} from "@/features/ai-external-mcp/utils/ai-external-mcp-headers.ts";

type Props = {
  draft: AiExternalMcpHeaderDraft;
  onChange: (draft: AiExternalMcpHeaderDraft) => void;
  /** Header names already stored. Values are never available to the client. */
  storedNames: string[];
  disabled?: boolean;
  /** Create mode has nothing stored, so "keep" is not an option. */
  allowKeep: boolean;
  error?: string | null;
};

const MASK = "•".repeat(8);

export default function ExternalMcpHeaderFields({
  draft,
  onChange,
  storedNames,
  disabled,
  allowKeep,
  error,
}: Props) {
  const { t } = useTranslation();
  const idPrefix = useId();

  const startReplace = () => {
    onChange({
      mode: "replace",
      rows: [createAiExternalMcpHeaderRow(`${idPrefix}-0`)],
    });
  };

  const confirmClear = () => {
    modals.openConfirmModal({
      title: t("ai.externalTools.clearHeaders"),
      children: <Text size="sm">{t("ai.externalTools.clearHeadersConfirm")}</Text>,
      labels: { confirm: t("ai.externalTools.clearHeaders"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => onChange({ mode: "clear" }),
    });
  };

  return (
    <Stack gap="xs">
      <div>
        <Text size="sm" fw={500}>
          {t("ai.externalTools.headers")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("ai.externalTools.headersDescription")}
        </Text>
      </div>

      {draft.mode === "keep" && (
        <Stack gap="xs">
          {storedNames.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("ai.externalTools.headersNone")}
            </Text>
          ) : (
            <Table withTableBorder>
              <Table.Tbody>
                {storedNames.map((name) => (
                  <Table.Tr key={name}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed" aria-hidden>
                        {MASK}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Text size="xs" c="dimmed">
            {t("ai.externalTools.headersHidden")}
          </Text>
          <Group gap="xs">
            <Button
              variant="light"
              size="compact-sm"
              onClick={startReplace}
              disabled={disabled}
            >
              {t("ai.externalTools.replaceHeaders")}
            </Button>
            {storedNames.length > 0 && (
              <Button
                variant="light"
                color="red"
                size="compact-sm"
                onClick={confirmClear}
                disabled={disabled}
              >
                {t("ai.externalTools.clearHeaders")}
              </Button>
            )}
          </Group>
        </Stack>
      )}

      {draft.mode === "clear" && (
        <Group gap="xs">
          <Badge color="red" variant="light">
            {t("ai.externalTools.clearHeadersPending")}
          </Badge>
          {allowKeep && (
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={() => onChange({ mode: "keep" })}
              disabled={disabled}
            >
              {t("ai.externalTools.undoClearHeaders")}
            </Button>
          )}
        </Group>
      )}

      {draft.mode === "replace" && (
        <Stack gap="xs">
          {draft.rows.map((row, index) => (
            <Group key={row.id} gap="xs" align="flex-end" wrap="nowrap">
              <TextInput
                label={index === 0 ? t("ai.externalTools.headerName") : undefined}
                value={row.name}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    rows: draft.rows.map((candidate) =>
                      candidate.id === row.id
                        ? { ...candidate, name: event.currentTarget.value }
                        : candidate,
                    ),
                  })
                }
                disabled={disabled}
                style={{ flex: 1 }}
              />
              <PasswordInput
                label={index === 0 ? t("ai.externalTools.headerValue") : undefined}
                value={row.value}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    rows: draft.rows.map((candidate) =>
                      candidate.id === row.id
                        ? { ...candidate, value: event.currentTarget.value }
                        : candidate,
                    ),
                  })
                }
                visibilityToggleButtonProps={{
                  "aria-label": t("ai.ux.toggleSecretVisibility"),
                }}
                disabled={disabled}
                style={{ flex: 1 }}
              />
              <AccessibleActionIcon
                label={t("ai.externalTools.removeHeader")}
                variant="subtle"
                color="red"
                onClick={() =>
                  onChange({
                    ...draft,
                    rows: draft.rows.filter(
                      (candidate) => candidate.id !== row.id,
                    ),
                  })
                }
                disabled={disabled}
              >
                <IconTrash size={16} />
              </AccessibleActionIcon>
            </Group>
          ))}

          <Group gap="xs">
            <Button
              variant="light"
              size="compact-sm"
              leftSection={<IconPlus size={14} />}
              onClick={() =>
                onChange({
                  ...draft,
                  rows: [
                    ...draft.rows,
                    createAiExternalMcpHeaderRow(
                      `${idPrefix}-${draft.rows.length}`,
                    ),
                  ],
                })
              }
              disabled={disabled}
            >
              {t("ai.externalTools.addHeader")}
            </Button>
            {allowKeep && (
              <Button
                variant="subtle"
                size="compact-sm"
                onClick={() => onChange({ mode: "keep" })}
                disabled={disabled}
              >
                {t("ai.externalTools.undoClearHeaders")}
              </Button>
            )}
          </Group>
        </Stack>
      )}

      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}
