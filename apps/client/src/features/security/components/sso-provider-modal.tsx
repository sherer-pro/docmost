import React from "react";
import { Modal } from "@mantine/core";
import { IAuthProvider } from "@/features/security/types/security.types.ts";
import { SsoSamlForm } from "@/features/security/components/sso-saml-form.tsx";
import { SSO_PROVIDER } from "@/features/security/constants.ts";
import { SsoOIDCForm } from "@/features/security/components/sso-oidc-form.tsx";
import { SsoLDAPForm } from "@/features/security/components/sso-ldap-form.tsx";
import { useTranslation } from "react-i18next";

interface SsoModalProps {
  opened: boolean;
  onClose: () => void;
  provider: IAuthProvider | null;
}

export default function SsoProviderModal({
  opened,
  onClose,
  provider,
}: SsoModalProps) {
  const { t } = useTranslation();

  if (!provider) {
    return null;
  }

  return (
    <Modal
      opened={opened}
      title={t("{{ssoProviderType}} configuration", {
        ssoProviderType: provider.type.toUpperCase(),
      })}
      onClose={onClose}
    >
      {provider.type === SSO_PROVIDER.SAML && (
        <SsoSamlForm provider={provider} onClose={onClose} />
      )}

      {provider.type === SSO_PROVIDER.OIDC && (
        <SsoOIDCForm provider={provider} onClose={onClose} />
      )}

      {provider.type === SSO_PROVIDER.LDAP && (
        <SsoLDAPForm provider={provider} onClose={onClose} />
      )}
    </Modal>
  );
}
