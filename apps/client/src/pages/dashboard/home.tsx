import { Space } from "@mantine/core";
import HomeTabs from "@/features/home/components/home-tabs";
import SpaceGrid from "@/features/space/components/space-grid.tsx";
import { getAppName } from "@/lib/config.ts";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import FavoriteList from "@/features/favorite/components/favorite-list";
import { PageFrame, SectionHeader } from "@/components/ui/page-frame";

export default function Home() {
  const { t } = useTranslation();

  return (
    <>
      <Helmet>
        <title>
          {t("Home")} - {getAppName()}
        </title>
      </Helmet>
      <PageFrame size="document">
        <SectionHeader title={t("Home")} />

        <FavoriteList hideEmpty />

        <Space h="xl" />

        <SpaceGrid />

        <Space h="xl" />

        <HomeTabs />
      </PageFrame>
    </>
  );
}
