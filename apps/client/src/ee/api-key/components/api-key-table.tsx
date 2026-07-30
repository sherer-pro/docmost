import { Group, Menu, Table, Text } from "@mantine/core";
import { IconDots, IconEdit, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { IApiKey } from "@/ee/api-key";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import React from "react";
import NoTableResults from "@/components/common/no-table-results";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import tableClasses from "@/components/ui/responsive-table.module.css";
import {
  getResponsiveActionCellProps,
  getResponsiveMetaCellProps,
  getResponsivePrimaryCellProps,
} from "@/components/ui/responsive-table";

interface ApiKeyTableProps {
  apiKeys: IApiKey[];
  isLoading?: boolean;
  showUserColumn?: boolean;
  showSpaceColumn?: boolean;
  onUpdate?: (apiKey: IApiKey) => void;
  onRevoke?: (apiKey: IApiKey) => void;
}

export function ApiKeyTable({
  apiKeys,
  isLoading,
  showUserColumn = false,
  showSpaceColumn = false,
  onUpdate,
  onRevoke,
}: ApiKeyTableProps) {
  const { t, i18n } = useTranslation();

  const formatDate = (date: Date | string | null) => {
    if (!date) return t("Never");
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
    }).format(new Date(date));
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <Table.ScrollContainer
      minWidth={500}
      className={tableClasses.responsiveScroll}
    >
      <Table
        highlightOnHover
        verticalSpacing="sm"
        className={tableClasses.responsiveTable}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("Name")}</Table.Th>
            {showUserColumn && <Table.Th>{t("User")}</Table.Th>}
            {showSpaceColumn && <Table.Th>{t("Space")}</Table.Th>}
            <Table.Th>{t("Type")}</Table.Th>
            <Table.Th>{t("Last used")}</Table.Th>
            <Table.Th>{t("Expires")}</Table.Th>
            <Table.Th>{t("Created")}</Table.Th>
            <Table.Th></Table.Th>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {apiKeys && apiKeys.length > 0 ? (
            apiKeys.map((apiKey: IApiKey, index: number) => (
              <Table.Tr key={index}>
                <Table.Td {...getResponsivePrimaryCellProps(t("Name"))}>
                  <Text fz="sm" fw={500}>
                    {apiKey.name}
                  </Text>
                </Table.Td>

                {showUserColumn && (
                  <Table.Td {...getResponsiveMetaCellProps(t("User"))}>
                    <Group gap="4" wrap="nowrap">
                      <CustomAvatar
                        avatarUrl={apiKey.creator?.avatarUrl}
                        name={apiKey.creator?.name}
                        size="sm"
                      />
                      <Text fz="sm" lineClamp={1}>
                        {apiKey.creator?.name || "-"}
                      </Text>
                    </Group>
                  </Table.Td>
                )}

                {showSpaceColumn && (
                  <Table.Td {...getResponsiveMetaCellProps(t("Space"))}>
                    <Text fz="sm" lineClamp={1}>
                      {apiKey.space?.name || "-"}
                    </Text>
                  </Table.Td>
                )}

                <Table.Td {...getResponsiveMetaCellProps(t("Type"))}>
                  <Text fz="sm">
                    {apiKey.keyType === "mcp"
                      ? t("MCP read-only")
                      : t("RAG sync")}
                  </Text>
                </Table.Td>

                <Table.Td {...getResponsiveMetaCellProps(t("Last used"))}>
                  <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                    {formatDate(apiKey.lastUsedAt)}
                  </Text>
                </Table.Td>

                <Table.Td {...getResponsiveMetaCellProps(t("Expires"))}>
                  {apiKey.expiresAt ? (
                    isExpired(apiKey.expiresAt) ? (
                      <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                        {t("Expired")}
                      </Text>
                    ) : (
                      <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                        {formatDate(apiKey.expiresAt)}
                      </Text>
                    )
                  ) : (
                    <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                      {t("Never")}
                    </Text>
                  )}
                </Table.Td>

                <Table.Td {...getResponsiveMetaCellProps(t("Created"))}>
                  <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                    {formatDate(apiKey.createdAt)}
                  </Text>
                </Table.Td>

                <Table.Td {...getResponsiveActionCellProps()}>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <AccessibleActionIcon
                        label={t("More options")}
                        variant="subtle"
                        color="gray"
                      >
                        <IconDots size={16} />
                      </AccessibleActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {onUpdate && (
                        <Menu.Item
                          leftSection={<IconEdit size={16} />}
                          onClick={() => onUpdate(apiKey)}
                        >
                          {t("Rename")}
                        </Menu.Item>
                      )}
                      {onRevoke && (
                        <Menu.Item
                          leftSection={<IconTrash size={16} />}
                          color="red"
                          onClick={() => onRevoke(apiKey)}
                        >
                          {t("Revoke")}
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <NoTableResults
              text={t("No API keys found")}
              colSpan={6 + (showUserColumn ? 1 : 0) + (showSpaceColumn ? 1 : 0)}
            />
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
