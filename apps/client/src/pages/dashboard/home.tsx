import { Container, Space, Title } from "@mantine/core";
import HomeTabs from "@/features/home/components/home-tabs";
import SpaceGrid from "@/features/space/components/space-grid.tsx";
import { getAppName } from "@/lib/config.ts";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import FavoriteList from "@/features/favorite/components/favorite-list";

export default function Home() {
  const { t } = useTranslation();

  return (
    <>
      <Helmet>
        <title>
          {t("Home")} - {getAppName()}
        </title>
      </Helmet>
      <Container size={"800"} pt="xl">
        <Title order={2} mb="lg">
          {t("Home")}
        </Title>

        <FavoriteList hideEmpty />

        <Space h="xl" />

        <SpaceGrid />

        <Space h="xl" />

        <HomeTabs />
      </Container>
    </>
  );
}
