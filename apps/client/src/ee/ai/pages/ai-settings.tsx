import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config.ts";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import React from "react";
import useUserRole from "@/hooks/use-user-role.tsx";
import { useTranslation } from "react-i18next";
import EnableAiSearch from "@/ee/ai/components/enable-ai-search.tsx";
import { Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useIsCloudEE } from "@/hooks/use-is-cloud-ee.tsx";
import { isCloud } from "@/lib/config.ts";

export default function AiSettings() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const hasAccess = useIsCloudEE();

  if (!isAdmin) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>
          {t("AI search")} - {getAppName()}
        </title>
      </Helmet>
      <SettingsTitle title={t("AI search")} />

      {!hasAccess && (
        <Alert
          icon={<IconInfoCircle />}
          title={t("Enterprise feature")}
          color="blue"
          mb="lg"
        >
          {t(
            "AI search uses vector embeddings to provide semantic search capabilities across your workspace content.",
          )}
        </Alert>
      )}

      {!isCloud() && <EnableAiSearch />}
    </>
  );
}
