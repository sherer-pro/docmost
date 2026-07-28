import { Badge, Group, Table, Text } from "@mantine/core";
import React, { useState } from "react";
import { useCursorPaginate } from "@/hooks/use-cursor-paginate";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import SpaceSettingsModal from "@/features/space/components/settings-modal.tsx";
import { useDisclosure } from "@mantine/hooks";
import { formatMemberCount } from "@/lib";
import { useTranslation } from "react-i18next";
import Paginate from "@/components/common/paginate.tsx";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { AvatarIconType } from "@/features/attachments/types/attachment.types.ts";
import { AutoTooltipText } from "@/components/ui/auto-tooltip-text.tsx";
import tableClasses from "@/components/ui/responsive-table.module.css";
import NoTableResults from "@/components/common/no-table-results.tsx";
import {
  getResponsiveMetaCellProps,
  getResponsivePrimaryCellProps,
} from "@/components/ui/responsive-table";
import { useNavigate } from "react-router-dom";
import { getSpaceUrl } from "@/lib/config";
import useUserRole from "@/hooks/use-user-role";

export default function SpaceList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAdmin } = useUserRole();
  const { cursor, goNext, goPrev } = useCursorPaginate();
  const { data, isLoading } = useGetSpacesQuery({
    cursor,
    includeArchived: true,
  });
  const [opened, { open, close }] = useDisclosure(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(null);

  const handleClick = (space: { id: string; slug: string }) => {
    if (isAdmin) {
      setSelectedSpaceId(space.id);
      open();
      return;
    }

    navigate(getSpaceUrl(space.slug));
  };

  return (
    <>
      <Table.ScrollContainer
        minWidth={500}
        className={tableClasses.responsiveScroll}
      >
        <Table
          highlightOnHover
          verticalSpacing="sm"
          layout="fixed"
          className={tableClasses.responsiveTable}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Space")}</Table.Th>
              <Table.Th>{t("Members")}</Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {data?.items.length > 0 ? (
              data?.items.map((space, index) => (
                <Table.Tr
                  key={index}
                  style={{ cursor: "pointer" }}
                  onClick={() => handleClick(space)}
                >
                  <Table.Td {...getResponsivePrimaryCellProps(t("Space"))}>
                    <Group gap="sm" wrap="nowrap">
                      <CustomAvatar
                        avatarUrl={space.logo}
                        type={AvatarIconType.SPACE_ICON}
                        variant="filled"
                        name={space.name}
                      />
                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <Group gap="xs" wrap="nowrap">
                          <AutoTooltipText
                            fz="sm"
                            fw={500}
                            lineClamp={1}
                            style={{ minWidth: 0, flex: 1 }}
                          >
                            {space.name}
                          </AutoTooltipText>
                          {space.archivedAt && (
                            <Badge size="xs" variant="light" color="gray">
                              {t("Archived")}
                            </Badge>
                          )}
                        </Group>
                        <Text fz="xs" c="dimmed" lineClamp={2}>
                          {space.description}
                        </Text>
                      </div>
                    </Group>
                  </Table.Td>
                  <Table.Td {...getResponsiveMetaCellProps(t("Members"))}>
                    <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                      {formatMemberCount(space.memberCount, t)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))
            ) : (
              <NoTableResults colSpan={2} />
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

      {selectedSpaceId && (
        <SpaceSettingsModal
          opened={opened}
          onClose={close}
          spaceId={selectedSpaceId}
        />
      )}
    </>
  );
}
