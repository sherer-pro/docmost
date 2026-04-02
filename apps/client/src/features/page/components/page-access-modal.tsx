import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
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
import { stopPageAccessModalEvent } from "@/features/page/utils/page-access-ui";
import { useSearchSuggestionsQuery } from "@/features/search/queries/search-query.ts";

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

  const [newUserId, setNewUserId] = useState<string | null>(null);
  const [newGroupId, setNewGroupId] = useState<string | null>(null);
  const [newUserSearchValue, setNewUserSearchValue] = useState("");
  const [newGroupSearchValue, setNewGroupSearchValue] = useState("");
  const [newRole, setNewRole] = useState<"reader" | "writer">("reader");
  const [debouncedUserSearch] = useDebouncedValue(newUserSearchValue, 300);
  const [debouncedGroupSearch] = useDebouncedValue(newGroupSearchValue, 300);

  const { data: userSuggestions, isLoading: isUserSuggestionsLoading } =
    useSearchSuggestionsQuery({
      query: debouncedUserSearch,
      includeUsers: true,
      includeGroups: true,
    });
  const { data: groupSuggestions, isLoading: isGroupSuggestionsLoading } =
    useSearchSuggestionsQuery({
      query: debouncedGroupSearch,
      includeUsers: true,
      includeGroups: true,
    });

  const userSelectOptions = (userSuggestions?.users ?? []).map((user: any) => {
    const primaryLabel = user?.name || user?.email || user?.id;
    const secondaryLabel =
      user?.email && user?.email !== primaryLabel ? ` • ${user.email}` : "";

    return {
      value: user.id,
      label: `${primaryLabel}${secondaryLabel}`,
    };
  });

  const groupSelectOptions = (groupSuggestions?.groups ?? []).map(
    (group: any) => ({
      value: group.id,
      label: group.name,
    }),
  );

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
      return t("page.access.source.system", { keySeparator: false });
    }
    if (source === "space") {
      return t("page.access.source.space", { keySeparator: false });
    }
    if (source === "page_user") {
      return t("page.access.source.pageUser", { keySeparator: false });
    }
    if (source === "page_group") {
      return t("page.access.source.pageGroup", { keySeparator: false });
    }
    return source;
  }

  function getRoleLabel(role: "reader" | "writer" | null) {
    if (role === "reader") {
      return t("page.access.role.reader", { keySeparator: false });
    }
    if (role === "writer") {
      return t("page.access.role.writer", { keySeparator: false });
    }
    return t("page.access.role.none", { keySeparator: false });
  }

  function getEffectLabel(effect: "allow" | "deny") {
    if (effect === "allow") {
      return t("page.access.effect.allow", { keySeparator: false });
    }
    return t("page.access.effect.deny", { keySeparator: false });
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    void reloadActiveTab();
  }, [open, activeTab, query]);

  async function onGrantUser() {
    if (!newUserId?.trim()) {
      return;
    }

    try {
      await grantPageUserAccess(pageId, {
        userId: newUserId,
        role: newRole,
      });
      setNewUserId(null);
      setNewUserSearchValue("");
      await loadUsers();
      notifications.show({
        message: t("page.access.updated", { keySeparator: false }),
      });
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ||
          t("page.access.updateFailed", { keySeparator: false }),
      });
    }
  }

  async function onGrantGroup() {
    if (!newGroupId?.trim()) {
      return;
    }

    try {
      await grantPageGroupAccess(pageId, {
        groupId: newGroupId,
        role: newRole,
      });
      setNewGroupId(null);
      setNewGroupSearchValue("");
      await loadGroups();
      notifications.show({
        message: t("page.access.updated", { keySeparator: false }),
      });
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ||
          t("page.access.updateFailed", { keySeparator: false }),
      });
    }
  }

  async function onCloseUserAccess(userId: string) {
    try {
      await closePageUserAccess(pageId, { userId });
      await loadUsers();
      notifications.show({
        message: t("page.access.updated", { keySeparator: false }),
      });
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ||
          t("page.access.updateFailed", { keySeparator: false }),
      });
    }
  }

  async function onCloseGroupAccess(groupId: string) {
    try {
      await closePageGroupAccess(pageId, { groupId });
      await loadGroups();
      notifications.show({
        message: t("page.access.updated", { keySeparator: false }),
      });
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ||
          t("page.access.updateFailed", { keySeparator: false }),
      });
    }
  }

  return (
    <Modal.Root
      opened={open}
      onClose={onClose}
      size="lg"
      centered
      onClick={stopPageAccessModalEvent}
    >
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t("page.access.title", { keySeparator: false })}</Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          <Stack gap="sm">
            <TextInput
              placeholder={t("Search")}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />

            <Tabs value={activeTab} onChange={setActiveTab}>
              <Tabs.List>
                <Tabs.Tab value="users">
                  {t("page.access.tab.users", { keySeparator: false })}
                </Tabs.Tab>
                <Tabs.Tab value="groups">
                  {t("page.access.tab.groups", { keySeparator: false })}
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="users" pt="md">
                <Group align="end" grow>
                  <Select
                    label={t("page.access.label.user", { keySeparator: false })}
                    placeholder={t("Search for users")}
                    value={newUserId}
                    onChange={setNewUserId}
                    data={userSelectOptions}
                    searchable
                    searchValue={newUserSearchValue}
                    onSearchChange={setNewUserSearchValue}
                    rightSection={
                      isUserSuggestionsLoading ? <Loader size="xs" /> : null
                    }
                    nothingFoundMessage={
                      newUserSearchValue
                        ? t("No user found")
                        : t("Start typing to search...")
                    }
                  />
                  <Select
                    label={t("page.access.label.role", { keySeparator: false })}
                    data={[
                      {
                        label: t("page.access.role.reader", {
                          keySeparator: false,
                        }),
                        value: "reader",
                      },
                      {
                        label: t("page.access.role.writer", {
                          keySeparator: false,
                        }),
                        value: "writer",
                      },
                    ]}
                    value={newRole}
                    onChange={(value) =>
                      setNewRole((value as "reader" | "writer") ?? "reader")
                    }
                  />
                  <Button disabled={!newUserId} onClick={() => void onGrantUser()}>
                    {t("page.access.action.grant", { keySeparator: false })}
                  </Button>
                </Group>

                <ScrollArea h={360} mt="md">
                  <Table striped withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>
                          {t("page.access.column.user", { keySeparator: false })}
                        </Table.Th>
                        <Table.Th>
                          {t("page.access.column.role", { keySeparator: false })}
                        </Table.Th>
                        <Table.Th>
                          {t("page.access.column.source", {
                            keySeparator: false,
                          })}
                        </Table.Th>
                        <Table.Th>
                          {t("page.access.column.action", {
                            keySeparator: false,
                          })}
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {users.length === 0 && (
                        <Table.Tr>
                          <Table.Td colSpan={4}>
                            <Text c="dimmed" size="sm">
                              {isUsersLoading
                                ? t("page.access.state.loading", {
                                    keySeparator: false,
                                  })
                                : t("page.access.state.empty", {
                                    keySeparator: false,
                                  })}
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
                              {t("page.access.action.close", {
                                keySeparator: false,
                              })}
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
                  <Select
                    label={t("page.access.label.group", { keySeparator: false })}
                    placeholder={t("Search for groups")}
                    value={newGroupId}
                    onChange={setNewGroupId}
                    data={groupSelectOptions}
                    searchable
                    searchValue={newGroupSearchValue}
                    onSearchChange={setNewGroupSearchValue}
                    rightSection={
                      isGroupSuggestionsLoading ? <Loader size="xs" /> : null
                    }
                    nothingFoundMessage={
                      newGroupSearchValue
                        ? t("No group found")
                        : t("Start typing to search...")
                    }
                  />
                  <Select
                    label={t("page.access.label.role", { keySeparator: false })}
                    data={[
                      {
                        label: t("page.access.role.reader", {
                          keySeparator: false,
                        }),
                        value: "reader",
                      },
                      {
                        label: t("page.access.role.writer", {
                          keySeparator: false,
                        }),
                        value: "writer",
                      },
                    ]}
                    value={newRole}
                    onChange={(value) =>
                      setNewRole((value as "reader" | "writer") ?? "reader")
                    }
                  />
                  <Button disabled={!newGroupId} onClick={() => void onGrantGroup()}>
                    {t("page.access.action.grant", { keySeparator: false })}
                  </Button>
                </Group>

                <ScrollArea h={360} mt="md">
                  <Table striped withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>
                          {t("page.access.column.group", { keySeparator: false })}
                        </Table.Th>
                        <Table.Th>
                          {t("page.access.column.effect", { keySeparator: false })}
                        </Table.Th>
                        <Table.Th>
                          {t("page.access.column.role", { keySeparator: false })}
                        </Table.Th>
                        <Table.Th>
                          {t("page.access.column.action", {
                            keySeparator: false,
                          })}
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {groups.length === 0 && (
                        <Table.Tr>
                          <Table.Td colSpan={4}>
                            <Text c="dimmed" size="sm">
                              {isGroupsLoading
                                ? t("page.access.state.loading", {
                                    keySeparator: false,
                                  })
                                : t("page.access.state.empty", {
                                    keySeparator: false,
                                  })}
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
                              {t("page.access.action.close", {
                                keySeparator: false,
                              })}
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
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
