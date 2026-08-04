import { useState } from "react";
import { useWorkspacePublicDataQuery } from "@/features/workspace/queries/workspace-query.ts";
import { Button, Divider, Stack } from "@mantine/core";
import { IconLock, IconServer } from "@tabler/icons-react";
import { IPublicAuthProvider } from "@/features/security/types/security.types.ts";
import { buildSsoLoginUrl } from "@/features/security/sso.utils.ts";
import { SSO_PROVIDER } from "@/features/security/constants.ts";
import { LdapLoginModal } from "@/features/security/components/ldap-login-modal.tsx";
import { useTranslation } from "react-i18next";

export default function SsoLogin({
  spaceSlug,
  returnTo,
}: {
  spaceSlug?: string;
  returnTo?: string;
}) {
  const { t } = useTranslation();
  const { data } = useWorkspacePublicDataQuery(spaceSlug);
  const [ldapModalOpened, setLdapModalOpened] = useState(false);
  const [selectedLdapProvider, setSelectedLdapProvider] =
    useState<IPublicAuthProvider | null>(null);

  if (!data?.authProviders || data?.authProviders?.length === 0) {
    return null;
  }

  const handleSsoLogin = (provider: IPublicAuthProvider) => {
    if (provider.type === SSO_PROVIDER.LDAP) {
      // Open modal for LDAP instead of redirecting
      setSelectedLdapProvider(provider);
      setLdapModalOpened(true);
    } else {
      // Redirect for other SSO providers
      window.location.href = buildSsoLoginUrl({
        providerId: provider.id,
        type: provider.type,
        spaceSlug,
        returnTo,
      });
    }
  };

  const getProviderIcon = (provider: IPublicAuthProvider) => {
    if (provider.type === SSO_PROVIDER.LDAP) {
      return <IconServer size={16} />;
    }
    return <IconLock size={16} />;
  };

  return (
    <>
      {selectedLdapProvider && (
        <LdapLoginModal
          opened={ldapModalOpened}
          onClose={() => {
            setLdapModalOpened(false);
            setSelectedLdapProvider(null);
          }}
          provider={selectedLdapProvider}
          spaceSlug={spaceSlug}
          returnTo={returnTo}
        />
      )}

      <Stack align="stretch" justify="center" gap="sm">
        {data.authProviders.map((provider) => (
          <div key={provider.id}>
            <Button
              onClick={() => handleSsoLogin(provider)}
              leftSection={getProviderIcon(provider)}
              variant="default"
              fullWidth
            >
              {provider.name}
            </Button>
          </div>
        ))}
      </Stack>

      {!data.enforceSso && (
        <Divider my="xs" label={t("OR")} labelPosition="center" />
      )}
    </>
  );
}
