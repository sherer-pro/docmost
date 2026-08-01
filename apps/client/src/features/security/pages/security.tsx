import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config.ts";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { Divider, Title } from "@mantine/core";
import React from "react";
import useUserRole from "@/hooks/use-user-role.tsx";
import SsoProviderList from "@/features/security/components/sso-provider-list.tsx";
import CreateSsoProvider from "@/features/security/components/create-sso-provider.tsx";
import EnforceSso from "@/features/security/components/enforce-sso.tsx";
import AllowedDomains from "@/features/security/components/allowed-domains.tsx";
import { useTranslation } from "react-i18next";
import EnforceMfa from "@/features/security/components/enforce-mfa.tsx";
import DisablePublicSharing from "@/features/security/components/disable-public-sharing.tsx";

export default function Security() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();

  if (!isAdmin) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>
          {t("Security")} - {getAppName()}
        </title>
      </Helmet>
      <SettingsTitle title={t("Security")} />

      <EnforceMfa />

      <Divider my="lg" />

      <DisablePublicSharing />
      <Divider my="lg" />

      <Title order={4} my="lg">
        {t("Single sign-on (SSO)")}
      </Title>

      <EnforceSso />
      <Divider my="lg" />

      <AllowedDomains />
      <Divider my="lg" />

      <CreateSsoProvider />
      <Divider size={0} my="lg" />

      <SsoProviderList />
    </>
  );
}
