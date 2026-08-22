import { Box } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config";
import { useGetSpacesQuery } from "@/features/space/queries/space-query";
import CreateSpaceModal from "@/features/space/components/create-space-modal";
import { AllSpacesList } from "@/features/space/components/spaces-page";
import { usePaginateAndSearch } from "@/hooks/use-paginate-and-search";
import useUserRole from "@/hooks/use-user-role";
import { PageFrame, SectionHeader } from "@/components/ui/page-frame";

export default function Spaces() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const { search, cursor, goNext, goPrev, handleSearch } =
    usePaginateAndSearch();

  const { data, isLoading, isError, refetch } = useGetSpacesQuery({
    cursor,
    limit: 30,
    query: search,
  });

  return (
    <>
      <Helmet>
        <title>
          {t("Spaces")} - {getAppName()}
        </title>
      </Helmet>

      <PageFrame size="document">
        <SectionHeader
          title={t("Spaces")}
          description={t("Spaces you belong to")}
          actions={isAdmin ? <CreateSpaceModal /> : undefined}
        />
        <Box>
          <AllSpacesList
            spaces={data?.items || []}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
            onSearch={handleSearch}
            hasPrevPage={data?.meta?.hasPrevPage}
            hasNextPage={data?.meta?.hasNextPage}
            onNext={() => goNext(data?.meta?.nextCursor)}
            onPrev={goPrev}
          />
        </Box>
      </PageFrame>
    </>
  );
}
