import {
  Text,
  Group,
  UnstyledButton,
  Badge,
  Table,
  ThemeIcon,
} from "@mantine/core";
import { Link } from "react-router-dom";
import PageListSkeleton from "@/components/ui/page-list-skeleton.tsx";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { formattedDate } from "@/lib/time.ts";
import { useRecentChangesQuery } from "@/features/page/queries/page-query.ts";
import {
  IconFileDatabase,
  IconFileDescription,
  IconFiles,
} from "@tabler/icons-react";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { getSpaceUrl } from "@/lib/config.ts";
import { useTranslation } from "react-i18next";
import { getInitialsColor } from "@/lib/get-initials-color.ts";
import tableClasses from "@/components/ui/responsive-table.module.css";
import {
  getResponsiveMetaCellProps,
  getResponsivePrimaryCellProps,
} from "@/components/ui/responsive-table";

interface Props {
  spaceId?: string;
}

type RecentChangeNode = {
  databaseId?: string | null;
  nodeType?: "page" | "database" | "databaseRow";
};

function isDatabaseNode(page: RecentChangeNode): boolean {
  return page?.nodeType === "database" || Boolean(page?.databaseId);
}

export default function RecentChanges({ spaceId }: Props) {
  const { t } = useTranslation();
  const { data: pages, isLoading, isError } = useRecentChangesQuery(spaceId);

  if (isLoading) {
    return <PageListSkeleton />;
  }

  if (isError) {
    return <Text>{t("Failed to fetch recent pages")}</Text>;
  }

  return pages && pages.items.length > 0 ? (
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
            <Table.Th>{t("Page")}</Table.Th>
            {!spaceId && <Table.Th>{t("Space")}</Table.Th>}
            <Table.Th>{t("Date")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {pages.items.map((page) => (
            <Table.Tr key={page.id}>
              <Table.Td {...getResponsivePrimaryCellProps(t("Page"))}>
                <UnstyledButton
                  component={Link}
                  to={buildPageUrl(page?.space.slug, page.slugId, page.title)}
                >
                  <Group wrap="nowrap">
                    {page.icon || (
                      <ThemeIcon variant="transparent" color="gray" size={18}>
                        {isDatabaseNode(page) ? (
                          <IconFileDatabase size={18} />
                        ) : (
                          <IconFileDescription size={18} />
                        )}
                      </ThemeIcon>
                    )}

                    <Text fw={500} size="md" lineClamp={1}>
                      {page.title || t("Untitled")}
                    </Text>
                  </Group>
                </UnstyledButton>
              </Table.Td>
              {!spaceId && (
                <Table.Td {...getResponsiveMetaCellProps(t("Space"))}>
                  <Badge
                    color={getInitialsColor(page?.space.name)}
                    variant="light"
                    component={Link}
                    to={getSpaceUrl(page?.space.slug)}
                    style={{ cursor: "pointer" }}
                  >
                    {page?.space.name}
                  </Badge>
                </Table.Td>
              )}
              <Table.Td {...getResponsiveMetaCellProps(t("Date"))}>
                <Text
                  c="dimmed"
                  style={{ whiteSpace: "nowrap" }}
                  size="xs"
                  fw={500}
                >
                  {formattedDate(page.updatedAt)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  ) : (
    <EmptyState
      icon={IconFiles}
      title={t("No pages yet")}
      description={t("Pages you create will show up here.")}
    />
  );
}
