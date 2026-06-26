import { Box, Group, Table, Text, Badge } from "@mantine/core";
import {
  useChangeMemberRoleMutation,
  useWorkspaceMembersQuery,
  useWorkspaceMembersPresenceQuery,
} from "@/features/workspace/queries/workspace-query.ts";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import React, { useMemo, useState } from "react";
import RoleSelectMenu from "@/components/ui/role-select-menu.tsx";
import {
  getUserRoleLabel,
  userRoleData,
} from "@/features/workspace/types/user-role-data.ts";
import useUserRole from "@/hooks/use-user-role.tsx";
import { UserRole } from "@/lib/types.ts";
import { useTranslation } from "react-i18next";
import Paginate from "@/components/common/paginate.tsx";
import { SearchInput } from "@/components/common/search-input.tsx";
import NoTableResults from "@/components/common/no-table-results.tsx";
import { usePaginateAndSearch } from "@/hooks/use-paginate-and-search.tsx";
import MemberActionMenu from "@/features/workspace/components/members/components/members-action-menu.tsx";
import {
  MemberPresenceCell,
  MemberPresenceDetails,
} from "@/features/workspace/components/members/components/workspace-member-presence.tsx";
import tableClasses from "@/components/ui/responsive-table.module.css";
import {
  getResponsiveActionCellProps,
  getResponsiveDetailsCellProps,
  getResponsiveMetaCellProps,
  getResponsivePrimaryCellProps,
} from "@/components/ui/responsive-table";

const ADMIN_TABLE_MIN_WIDTH = 720;
const MEMBER_TABLE_MIN_WIDTH = 560;

const columnWidths = {
  status: 96,
  presence: 158,
  role: 144,
  actions: 44,
};

export default function WorkspaceMembersTable() {
  const { t } = useTranslation();
  const { search, cursor, goNext, goPrev, handleSearch } =
    usePaginateAndSearch();
  const { data, isLoading } = useWorkspaceMembersQuery({
    cursor,
    limit: 100,
    query: search,
  });
  const changeMemberRoleMutation = useChangeMemberRoleMutation();
  const { isAdmin, isOwner } = useUserRole();
  const [expandedPresenceUserId, setExpandedPresenceUserId] = useState<
    string | null
  >(null);
  const userIds = useMemo(
    () => data?.items?.map((user) => user.id) ?? [],
    [data?.items],
  );
  const { data: presenceData } = useWorkspaceMembersPresenceQuery(
    userIds,
    isAdmin,
  );

  const assignableUserRoles = isOwner
    ? userRoleData
    : userRoleData.filter((role) => role.value !== UserRole.OWNER);
  const colSpan = isAdmin ? 5 : 4;

  const handleRoleChange = async (
    userId: string,
    currentRole: string,
    newRole: string,
  ) => {
    if (newRole === currentRole) {
      return;
    }

    const memberRoleUpdate = {
      userId: userId,
      role: newRole,
    };

    await changeMemberRoleMutation.mutateAsync(memberRoleUpdate);
  };

  return (
    <>
      <SearchInput onSearch={handleSearch} />
      <Table.ScrollContainer
        minWidth={isAdmin ? ADMIN_TABLE_MIN_WIDTH : MEMBER_TABLE_MIN_WIDTH}
        className={tableClasses.responsiveScroll}
      >
        <Table
          highlightOnHover
          verticalSpacing="sm"
          style={{ tableLayout: "fixed" }}
          className={tableClasses.responsiveTable}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("User")}</Table.Th>
              <Table.Th w={columnWidths.status}>{t("Status")}</Table.Th>
              {isAdmin && (
                <Table.Th w={columnWidths.presence}>{t("Presence")}</Table.Th>
              )}
              <Table.Th w={columnWidths.role}>{t("Role")}</Table.Th>
              <Table.Th w={columnWidths.actions} />
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {data?.items.length > 0 ? (
              data?.items.map((user) => {
                const presence = presenceData?.users?.[user.id];
                const isPresenceExpanded =
                  expandedPresenceUserId === user.id &&
                  Boolean(presence?.isOnline && presence.sessions.length > 0);

                return (
                  <React.Fragment key={user.id}>
                    <Table.Tr>
                      <Table.Td {...getResponsivePrimaryCellProps(t("User"))}>
                        <Group gap="sm" wrap="nowrap">
                          <CustomAvatar
                            avatarUrl={user.avatarUrl}
                            name={user.name}
                          />
                          <Box style={{ minWidth: 0 }}>
                            <Text fz="sm" fw={500} truncate="end">
                              {user.name}
                            </Text>
                            <Text fz="xs" c="dimmed" truncate="end">
                              {user.email}
                            </Text>
                          </Box>
                        </Group>
                      </Table.Td>
                      <Table.Td
                        {...getResponsiveMetaCellProps(t("Status"))}
                        w={columnWidths.status}
                      >
                        <Badge
                          variant="light"
                          color={user.deactivatedAt ? "orange" : undefined}
                        >
                          {user.deactivatedAt ? t("Deactivated") : t("Active")}
                        </Badge>
                      </Table.Td>
                      {isAdmin && (
                        <Table.Td
                          {...getResponsiveMetaCellProps(t("Presence"))}
                          w={columnWidths.presence}
                        >
                          <MemberPresenceCell
                            expanded={isPresenceExpanded}
                            presence={presence}
                            onToggle={() =>
                              setExpandedPresenceUserId((current) =>
                                current === user.id ? null : user.id,
                              )
                            }
                          />
                        </Table.Td>
                      )}
                      <Table.Td
                        {...getResponsiveMetaCellProps(t("Role"))}
                        w={columnWidths.role}
                      >
                        <RoleSelectMenu
                          roles={assignableUserRoles}
                          roleName={getUserRoleLabel(user.role)}
                          onChange={(newRole) =>
                            handleRoleChange(user.id, user.role, newRole)
                          }
                          disabled={!isAdmin}
                        />
                      </Table.Td>
                      <Table.Td
                        {...getResponsiveActionCellProps()}
                        w={columnWidths.actions}
                      >
                        {isAdmin && (
                          <MemberActionMenu
                            userId={user.id}
                            isDeactivated={Boolean(user.deactivatedAt)}
                          />
                        )}
                      </Table.Td>
                    </Table.Tr>
                    {isPresenceExpanded && (
                      <Table.Tr data-card-row="details">
                        <Table.Td
                          colSpan={colSpan}
                          {...getResponsiveDetailsCellProps()}
                        >
                          <Box
                            bg="var(--mantine-color-gray-0)"
                            p="sm"
                            style={{ borderRadius: 6 }}
                          >
                            <MemberPresenceDetails
                              sessions={presence?.sessions ?? []}
                            />
                          </Box>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <NoTableResults colSpan={colSpan} />
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {data?.items.length > 0 && (
        <Paginate
          hasPrevPage={data?.meta?.hasPrevPage}
          hasNextPage={data?.meta?.hasNextPage}
          onNext={() => goNext(data?.meta?.nextCursor)}
          onPrev={goPrev}
        />
      )}
    </>
  );
}
