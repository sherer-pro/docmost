import SpaceHomeTabs from "@/features/space/components/space-home-tabs.tsx";
import { useParams } from "react-router-dom";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { getAppName } from "@/lib/config.ts";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { PageFrame, SectionHeader } from "@/components/ui/page-frame";

export default function SpaceHome() {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);

  return (
    <>
      <Helmet>
        <title>
          {space?.name || t("Overview")} - {getAppName()}
        </title>
      </Helmet>
      <PageFrame size="document">
        <SectionHeader title={space?.name || t("Overview")} />
        {space && <SpaceHomeTabs />}
      </PageFrame>
    </>
  );
}
