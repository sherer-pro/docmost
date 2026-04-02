import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import {
  closePageGroupAccess,
  closePageUserAccess,
  getPageAccessGroups,
  getPageAccessUsers,
  grantPageGroupAccess,
  grantPageUserAccess,
} from "@/features/page/services/page-service";
import {
  PageAccessGroupRuleEntry,
  PageAccessUserEntry,
} from "@/features/page/types/page.types";

interface PageAccessModalProps {
  pageId: string;
  open: boolean;
  onClose: () => void;
}

export default function PageAccessModal({
  pageId,
  open,
  onClose,
}: PageAccessModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string | null>("users");
  const [query, setQuery] = useState("");
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isGroupsLoading, setIsGroupsLoading] = useState(false);
  const [users, setUsers] = useState<PageAccessUserEntry[]>([]);
  const [groups, setGroups] = useState<PageAccessGroupRuleEntry[]>([]);
  const [usersNextCursor, setUsersNextCursor] = useState<string | null>(null);
  const [usersHasNextPage, setUsersHasNextPage] = useState(false);
  const [groupsNextCursor, setGroupsNextCursor] = useState<string | null>(null);
  const [groupsHasNextPage, setGroupsHasNextPage] = useState(false);

  const [newUserId, setNewUserId] = useState("");
  const [newGroupId, setNewGroupId] = useState("");
  const [newRole, setNewRole] = useState<"reader" | "writer">("reader");

  async function loadUsers(params?: { append?: boolean; cursor?: string }) {
    setIsUsersLoading(true);
    try {
      const result = await getPageAccessUsers(pageId, {
        query,
        limit: 25,
        cursor: params?.cursor,
      });

      setUsers((prevUsers) =>
        params?.append ? [...prevUsers, ...(result.items ?? [])] : (result.items ?? []),
      );
      setUsersNextCursor(result.meta?.nextCursor ?? null);
      setUsersHasNextPage(Boolean(result.meta?.hasNextPage));
    } finally {
      setIsUsersLoading(false);
    }
  }

  async function loadGroups(params?: { append?: boolean; cursor?: string }) {
    setIsGroupsLoading(true);
    try {
      const result = await getPageAccessGroups(pageId, {
        query,
        limit: 25,
        cursor: params?.cursor,
      });

      setGroups((prevGroups) =>
        params?.append ? [...prevGroups, ...(result.items ?? [])] : (result.items ?? []),
      );
      setGroupsNextCursor(result.meta?.nextCursor ?? null);
      setGroupsHasNextPage(Boolean(result.meta?.hasNextPage));
    } finally {
      setIsGroupsLoading(false);
    }
  }

  async function reloadActiveTab() {
    if (activeTab === "groups") {
      await loadGroups();
      return;
    }
    await loadUsers();
  }

  function getSourceLabel(source: string) {
    if (source === "system") {
      return t("Page access source system");
    }
    if (source === "space") {
      return t("Page access source space");
    }
    if (source === "page_user") {
      return t("Page access source page user");
    }
    if (source === "page_group") {
      return t("Page access source page group");
    }
    return source;
  }

  function getRoleLabel(role: "reader" | "writer" | null) {
    if (role === "reader") {
      return t("Page access role reader");
    }
    if (role === "writer") {
      return t("Page access role writer");
    }
    return t("Page access no access");
  }

  function getEffectLabel(effect: "allow" | "deny") {
    if (effect === "allow") {
      return t("Page access effect allow");
    }
    return t("Page access effect deny");
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    void reloadActiveTab();
  }, [open, activeTab, query]);

  async function onGrantUser() {
    if (!newUserId.trim()) {
      return;
    }

    try {
      await grantPageUserAccess(pageId, {
        userId: newUserId.trim(),
        role: newRole,
      });
      setNewUserId("");
      await loadUsers();
      notifications.show({ message: t("Page access updated") });
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ||
          t("Failed to update page access"),
      });
    }
  }

  async function onGrantGroup() {
    if (!newGroupId.trim()) {
      return;
    }

    try {
      await grantPageGroupAccess(pageId, {
        groupId: newGroupId.trim(),
        role: newRole,
      });
      setNewGroupId("");
      await loadGroups();
      notifications.show({ message: t("Page access updated") });
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ||
          t("Failed to update page access"),
      });
    }
  }

  async function onCloseUserAccess(userId: string) {
    try {
      await closePageUserAccess(pageId, { userId });
      await loadUsers();
      notifications.show({ message: t("Page access updated") });
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ||
          t("Failed to update page access"),
      });
    }
  }

  async function onCloseGroupAccess(groupId: string) {
    try {
      await closePageGroupAccess(pageId, { groupId });
      await loadGroups();
      notifications.show({ message: t("Page access updated") });
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ||
          t("Failed to update page access"),
      });
    }
  }

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={t("Access")}
      size="lg"
      centered
    >
      <Stack gap="sm">
        <TextInput
          placeholder={t("Search")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />

        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List>
            <Tabs.Tab value="users">{t("Users")}</Tabs.Tab>
            <Tabs.Tab value="groups">{t("Groups")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="users" pt="md">
            <Group align="end" grow>
              <TextInput
                label={t("Page access user id")}
                value={newUserId}
                onChange={(event) => setNewUserId(event.currentTarget.value)}
              />
              <Select
                label={t("Role")}
                data={[
                  { label: t("Page access role reader"), value: "reader" },
                  { label: t("Page access role writer"), value: "writer" },
                ]}
                value={newRole}
                onChange={(value) =>
                  setNewRole((value as "reader" | "writer") ?? "reader")
                }
              />
              <Button onClick={() => void onGrantUser()}>{t("Grant")}</Button>
            </Group>

            <ScrollArea h={360} mt="md">
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("User")}</Table.Th>
                    <Table.Th>{t("Role")}</Table.Th>
                    <Table.Th>{t("Source")}</Table.Th>
                    <Table.Th>{t("Action")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {users.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={4}>
                        <Text c="dimmed" size="sm">
                          {isUsersLoading ? t("Loading") : t("No data")}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}

                  {users.map((user) => (
                    <Table.Tr key={user.id}>
                      <Table.Td>
                        <Text size="sm">{user.name || user.email || user.id}</Text>
                        {user.email && (
                          <Text size="xs" c="dimmed">
                            {user.email}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light">{getRoleLabel(user.access.role)}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {user.access.sources.map((source) => (
                            <Badge size="xs" key={`${user.id}-${source}`}>
                              {getSourceLabel(source)}
                            </Badge>
                          ))}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          disabled={!user.access.canClose}
                          onClick={() => void onCloseUserAccess(user.id)}
                        >
                          {t("Close")}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>

            {usersHasNextPage && (
              <Group justify="center" mt="sm">
                <Button
                  variant="subtle"
                  size="xs"
                  loading={isUsersLoading}
                  onClick={() =>
                    void loadUsers({
                      append: true,
                      cursor: usersNextCursor ?? undefined,
                    })
                  }
                >
                  {t("Load more")}
                </Button>
              </Group>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="groups" pt="md">
            <Group align="end" grow>
              <TextInput
                label={t("Page access group id")}
                value={newGroupId}
                onChange={(event) => setNewGroupId(event.currentTarget.value)}
              />
              <Select
                label={t("Role")}
                data={[
                  { label: t("Page access role reader"), value: "reader" },
                  { label: t("Page access role writer"), value: "writer" },
                ]}
                value={newRole}
                onChange={(value) =>
                  setNewRole((value as "reader" | "writer") ?? "reader")
                }
              />
              <Button onClick={() => void onGrantGroup()}>{t("Grant")}</Button>
            </Group>

            <ScrollArea h={360} mt="md">
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("Group")}</Table.Th>
                    <Table.Th>{t("Effect")}</Table.Th>
                    <Table.Th>{t("Role")}</Table.Th>
                    <Table.Th>{t("Action")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {groups.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={4}>
                        <Text c="dimmed" size="sm">
                          {isGroupsLoading ? t("Loading") : t("No data")}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}

                  {groups.map((group) => (
                    <Table.Tr key={group.id}>
                      <Table.Td>{group.name}</Table.Td>
                      <Table.Td>
                        <Badge variant="light">{getEffectLabel(group.effect)}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light">{getRoleLabel(group.role)}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          onClick={() => void onCloseGroupAccess(group.id)}
                        >
                          {t("Close")}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>

            {groupsHasNextPage && (
              <Group justify="center" mt="sm">
                <Button
                  variant="subtle"
                  size="xs"
                  loading={isGroupsLoading}
                  onClick={() =>
                    void loadGroups({
                      append: true,
                      cursor: groupsNextCursor ?? undefined,
                    })
                  }
                >
                  {t("Load more")}
                </Button>
              </Group>
            )}
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Modal>
  );
}
