import { Text, Tabs, Space } from "@mantine/core";
import { IconClockHour3, IconStar } from "@tabler/icons-react";
import RecentChanges from "@/components/common/recent-changes.tsx";
import { useParams } from "react-router-dom";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { useTranslation } from "react-i18next";
import FavoriteList from "@/features/favorite/components/favorite-list";

export default function SpaceHomeTabs() {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);

  return (
    <Tabs defaultValue="recent">
      <Tabs.List>
        <Tabs.Tab value="favorites" leftSection={<IconStar size={18} />}>
          <Text size="sm" fw={500}>
            {t("Favorites")}
          </Text>
        </Tabs.Tab>
        <Tabs.Tab value="recent" leftSection={<IconClockHour3 size={18} />}>
          <Text size="sm" fw={500}>
            {t("Recently updated")}
          </Text>
        </Tabs.Tab>
      </Tabs.List>

      <Space my="md" />

      <Tabs.Panel value="favorites">
        {space?.id && <FavoriteList type="page" spaceId={space.id} />}
      </Tabs.Panel>

      <Tabs.Panel value="recent">
        {space?.id && <RecentChanges spaceId={space.id} />}
      </Tabs.Panel>
    </Tabs>
  );
}
