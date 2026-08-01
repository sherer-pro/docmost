import { SetupWorkspaceForm } from "@/features/auth/components/setup-workspace-form.tsx";
import { Helmet } from "react-helmet-async";
import React from "react";
import { getAppName } from "@/lib/config.ts";
import { useTranslation } from "react-i18next";

export default function CreateWorkspace() {
  const { t } = useTranslation();

  return (
    <>
      <Helmet>
        <title>
          {t("Create workspace")} - {getAppName()}
        </title>
      </Helmet>
      <SetupWorkspaceForm />
    </>
  );
}
