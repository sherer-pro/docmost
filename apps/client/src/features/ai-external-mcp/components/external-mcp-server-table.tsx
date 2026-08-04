import {
  Badge,
  Group,
  Menu,
  Switch,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconDots, IconPencil, IconTrash } from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { useTranslation } from "react-i18next";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import { AutoTooltipText } from "@/components/ui/auto-tooltip-text.tsx";
import {
  getResponsiveActionCellProps,
  getResponsiveMetaCellProps,
  getResponsivePrimaryCellProps,
} from "@/components/ui/responsive-table.ts";
import tableClasses from "@/components/ui/responsive-table.module.css";
import type { AiExternalMcpServerListItem } from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";

type Props = {
  servers: AiExternalMcpServerListItem[];
  deploymentEnabled: boolean;
  workspaceEnabled: boolean;
  onEdit: (serverId: string) => void;
  onDelete: (serverId: string) => void;
  onToggleEnabled: (server: AiExternalMcpServerListItem) => void;
  busyServerId?: string | null;
};

export default function ExternalMcpServerTable({
  servers,
  deploymentEnabled,
  workspaceEnabled,
  onEdit,
  onDelete,
  onToggleEnabled,
  busyServerId,
}: Props) {
  const { t } = useTranslation();

  const confirmDelete = (server: AiExternalMcpServerListItem) => {
    modals.openConfirmModal({
      title: t("ai.externalTools.deleteServer"),
      children: <Text size="sm">{t("ai.externalTools.deleteConfirm")}</Text>,
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => onDelete(server.id),
    });
  };

  return (
    <Table.ScrollContainer minWidth={700} className={tableClasses.responsiveScroll}>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("ai.externalTools.columnName")}</Table.Th>
            <Table.Th>{t("ai.externalTools.columnUrl")}</Table.Th>
            <Table.Th>{t("ai.externalTools.columnTools")}</Table.Th>
            <Table.Th>{t("ai.externalTools.columnHeaders")}</Table.Th>
            <Table.Th>{t("ai.externalTools.columnSpaces")}</Table.Th>
            <Table.Th>{t("ai.externalTools.columnStatus")}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {servers.map((server) => {
            const inactiveLabel = !deploymentEnabled
              ? t("ai.externalTools.deploymentDisabledBadge")
              : !workspaceEnabled
                ? t("ai.externalTools.workspaceDisabledBadge")
                : null;
            const cannotEnable = server.approvedToolCount === 0;

            return (
              <Table.Tr key={server.id}>
                <Table.Td
                  {...getResponsivePrimaryCellProps(
                    t("ai.externalTools.columnName"),
                  )}
                >
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={500}>
                      {server.name}
                    </Text>
                    <Badge variant="light" size="xs">
                      {server.namespace}
                    </Badge>
                  </Group>
                </Table.Td>

                <Table.Td
                  {...getResponsiveMetaCellProps(t("ai.externalTools.columnUrl"))}
                >
                  <AutoTooltipText size="sm" c="dimmed" ff="monospace" truncate>
                    {server.url}
                  </AutoTooltipText>
                </Table.Td>

                <Table.Td
                  {...getResponsiveMetaCellProps(
                    t("ai.externalTools.columnTools"),
                  )}
                >
                  <Text size="sm">
                    {t("ai.externalTools.toolCounts", {
                      approved: server.approvedToolCount,
                      discovered: server.discoveredToolCount,
                    })}
                  </Text>
                </Table.Td>

                <Table.Td
                  {...getResponsiveMetaCellProps(
                    t("ai.externalTools.columnHeaders"),
                  )}
                >
                  {/* A boolean only. Never a value and never a length. */}
                  <Badge
                    variant="light"
                    color={server.headersConfigured ? "blue" : "gray"}
                    size="xs"
                  >
                    {server.headersConfigured
                      ? t("ai.externalTools.headersConfigured")
                      : t("ai.externalTools.headersNone")}
                  </Badge>
                </Table.Td>

                <Table.Td
                  {...getResponsiveMetaCellProps(
                    t("ai.externalTools.columnSpaces"),
                  )}
                >
                  <Text size="sm">{server.boundSpaceCount}</Text>
                </Table.Td>

                <Table.Td
                  {...getResponsiveMetaCellProps(
                    t("ai.externalTools.columnStatus"),
                  )}
                >
                  <Group gap="xs" wrap="nowrap">
                    <Tooltip
                      label={
                        cannotEnable
                          ? t("ai.externalTools.enableBlockedNoTools")
                          : (inactiveLabel ?? "")
                      }
                      disabled={!cannotEnable && !inactiveLabel}
                    >
                      <Switch
                        checked={server.enabled}
                        onChange={() => onToggleEnabled(server)}
                        disabled={
                          !deploymentEnabled ||
                          busyServerId === server.id ||
                          (!server.enabled && cannotEnable)
                        }
                        aria-label={t("ai.externalTools.statusEnabled")}
                      />
                    </Tooltip>
                    {inactiveLabel && (
                      <Badge color="gray" variant="light" size="xs">
                        {inactiveLabel}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>

                <Table.Td {...getResponsiveActionCellProps()}>
                  <Menu withinPortal position="bottom-end">
                    <Menu.Target>
                      <AccessibleActionIcon
                        label={t("ai.externalTools.rowActions")}
                        variant="subtle"
                        color="gray"
                      >
                        <IconDots size={16} />
                      </AccessibleActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconPencil size={14} />}
                        onClick={() => onEdit(server.id)}
                      >
                        {t("Edit")}
                      </Menu.Item>
                      <Menu.Item
                        c="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => confirmDelete(server)}
                      >
                        {t("Delete")}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
