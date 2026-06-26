import { Group, Table, Text, Alert } from "@mantine/core";
import { useWorkspaceInvitationsQuery } from "@/features/workspace/queries/workspace-query.ts";
import React from "react";
import { getUserRoleLabel } from "@/features/workspace/types/user-role-data.ts";
import InviteActionMenu from "@/features/workspace/components/members/components/invite-action-menu.tsx";
import { IconInfoCircle } from "@tabler/icons-react";
import { timeAgo } from "@/lib/time.ts";
import useUserRole from "@/hooks/use-user-role.tsx";
import { useTranslation } from "react-i18next";
import Paginate from "@/components/common/paginate.tsx";
import { useCursorPaginate } from "@/hooks/use-cursor-paginate";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import tableClasses from "@/components/ui/responsive-table.module.css";
import NoTableResults from "@/components/common/no-table-results.tsx";
import {
  getResponsiveActionCellProps,
  getResponsiveMetaCellProps,
  getResponsivePrimaryCellProps,
} from "@/components/ui/responsive-table";

export default function WorkspaceInvitesTable() {
  const { t } = useTranslation();
  const { cursor, goNext, goPrev } = useCursorPaginate();
  const { data, isLoading } = useWorkspaceInvitationsQuery({
    cursor,
    limit: 100,
  });
  const { isAdmin } = useUserRole();

  return (
    <>
      <Alert variant="light" color="blue" icon={<IconInfoCircle />}>
        {t(
          "Invited members who are yet to accept their invitation will appear here.",
        )}
      </Alert>

      <Table.ScrollContainer
        minWidth={600}
        className={tableClasses.responsiveScroll}
      >
        <Table
          highlightOnHover
          verticalSpacing="sm"
          className={tableClasses.responsiveTable}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Email")}</Table.Th>
              <Table.Th>{t("Role")}</Table.Th>
              <Table.Th>{t("Date")}</Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {data?.items.length > 0 ? (
              data?.items.map((invitation, index) => (
                <Table.Tr key={index}>
                  <Table.Td {...getResponsivePrimaryCellProps(t("Email"))}>
                    <Group gap="sm" wrap="nowrap">
                      <CustomAvatar avatarUrl="" name={invitation.email} />
                      <div>
                        <Text fz="sm" fw={500}>
                          {invitation.email}
                        </Text>
                      </div>
                    </Group>
                  </Table.Td>

                  <Table.Td {...getResponsiveMetaCellProps(t("Role"))}>
                    {t(getUserRoleLabel(invitation.role))}
                  </Table.Td>

                  <Table.Td {...getResponsiveMetaCellProps(t("Date"))}>
                    {timeAgo(invitation.createdAt)}
                  </Table.Td>

                  <Table.Td {...getResponsiveActionCellProps()}>
                    {isAdmin && (
                      <InviteActionMenu invitationId={invitation.id} />
                    )}
                  </Table.Td>
                </Table.Tr>
              ))
            ) : (
              <NoTableResults colSpan={4} />
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
