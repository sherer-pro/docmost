import {
  Alert,
  Badge,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthenticationRequirement } from "@docmost/api-contract";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { IconLock, IconServer, IconShieldCheck } from "@tabler/icons-react";
import { ISpace } from "@/features/space/types/space.types.ts";
import { useWorkspacePublicDataQuery } from "@/features/workspace/queries/workspace-query.ts";
import { SSO_PROVIDER } from "@/features/security/constants.ts";
import { buildSsoStepUpUrl } from "@/features/security/sso.utils.ts";
import { ldapStepUp } from "@/features/security/services/ldap-auth-service.ts";
import {
  getMfaStatus,
  stepUpMfa,
} from "@/features/mfa/services/mfa-service.ts";
import { MfaSetupModal } from "@/features/mfa/components/mfa-setup-modal.tsx";
import { sanitizeRelativeReturnTo } from "@/features/auth/utils/return-to.ts";
import useAuth from "@/features/auth/hooks/use-auth.ts";

type AuthenticationStepUpProps = {
  requirements: AuthenticationRequirement[];
  spaceSlug?: string;
  spaces?: ISpace[];
};

function safeReturnTo(pathname: string, search: string) {
  return sanitizeRelativeReturnTo(`${pathname}${search}`);
}

export function AuthenticationStepUp({
  requirements,
  spaceSlug,
  spaces = [],
}: AuthenticationStepUpProps) {
  const { t } = useTranslation();
  const { logout, isLoading: isLogoutPending } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [mfaCode, setMfaCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupOpened, setSetupOpened] = useState(false);
  const [ldapProviderId, setLdapProviderId] = useState<string | null>(null);
  const [ldapUsername, setLdapUsername] = useState("");
  const [ldapPassword, setLdapPassword] = useState("");
  const { data: workspacePublic, isLoading: providersLoading } =
    useWorkspacePublicDataQuery(spaceSlug);
  const { data: mfaStatus, isLoading: mfaStatusLoading } = useQuery({
    queryKey: ["mfa-status", "step-up"],
    queryFn: getMfaStatus,
    enabled: requirements.includes("mfa"),
    staleTime: 0,
  });
  const activeRequirement = requirements[0];
  const returnTo = safeReturnTo(location.pathname, location.search);

  const refreshAssurance = async () => {
    await queryClient.refetchQueries({ queryKey: ["currentUser"] });
    await queryClient.invalidateQueries({ queryKey: ["spaces"] });
  };

  const submitMfa = async () => {
    setIsSubmitting(true);
    try {
      await stepUpMfa(mfaCode);
      setMfaCode("");
      await refreshAssurance();
    } catch (error: any) {
      notifications.show({
        color: "red",
        message: error.response?.data?.message ?? t("Invalid verification code"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitLdap = async () => {
    if (!ldapProviderId) return;
    setIsSubmitting(true);
    try {
      await ldapStepUp({
        providerId: ldapProviderId,
        username: ldapUsername,
        password: ldapPassword,
      });
      await refreshAssurance();
    } catch (error: any) {
      notifications.show({
        color: "red",
        message: error.response?.data?.message ?? t("Authentication failed"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container size={560} py="xl">
      <Paper withBorder radius="lg" p="xl">
        <Stack gap="lg">
          <Center>
            <IconShieldCheck size={44} />
          </Center>
          <div>
            <Title order={2} ta="center">
              {t("Additional authentication required")}
            </Title>
            <Text c="dimmed" ta="center" mt="xs">
              {t(
                "Complete the required authentication steps to access this area.",
              )}
            </Text>
          </div>

          <Group justify="center">
            {requirements.map((requirement) => (
              <Badge key={requirement} variant="light">
                {requirement === "sso" ? t("Single sign-on (SSO)") : t("MFA")}
              </Badge>
            ))}
          </Group>

          {activeRequirement === "sso" && (
            <Stack>
              {providersLoading ? (
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              ) : workspacePublic?.authProviders?.length ? (
                workspacePublic.authProviders.map((provider) =>
                  provider.type === SSO_PROVIDER.LDAP ? (
                    <div key={provider.id}>
                      <Button
                        variant="default"
                        fullWidth
                        leftSection={<IconServer size={16} />}
                        onClick={() => setLdapProviderId(provider.id)}
                      >
                        {provider.name}
                      </Button>
                      {ldapProviderId === provider.id && (
                        <Stack mt="sm">
                          <TextInput
                            label={t("LDAP username")}
                            name="username"
                            autoComplete="username"
                            value={ldapUsername}
                            onChange={(event) =>
                              setLdapUsername(event.currentTarget.value)
                            }
                          />
                          <PasswordInput
                            label={t("LDAP password")}
                            name="password"
                            autoComplete="current-password"
                            value={ldapPassword}
                            onChange={(event) =>
                              setLdapPassword(event.currentTarget.value)
                            }
                          />
                          <Button
                            loading={isSubmitting}
                            disabled={!ldapUsername || !ldapPassword}
                            onClick={submitLdap}
                          >
                            {t("Continue")}
                          </Button>
                        </Stack>
                      )}
                    </div>
                  ) : (
                    <Button
                      key={provider.id}
                      component="a"
                      href={buildSsoStepUpUrl({
                        providerId: provider.id,
                        type: provider.type,
                        spaceSlug,
                        returnTo,
                      })}
                      variant="default"
                      fullWidth
                      leftSection={<IconLock size={16} />}
                    >
                      {provider.name}
                    </Button>
                  ),
                )
              ) : (
                <Alert color="red">
                  {t("No SSO provider is available for step-up authentication.")}
                </Alert>
              )}
            </Stack>
          )}

          {activeRequirement === "mfa" && (
            <Stack align="center">
              {mfaStatusLoading ? (
                <Loader size="sm" />
              ) : mfaStatus?.isEnabled ? (
                <>
                  <Text size="sm" ta="center">
                    {t("Enter a code from your authenticator or a backup code.")}
                  </Text>
                  <TextInput
                    name="mfaCode"
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.currentTarget.value)}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    aria-label={t("Verification code")}
                  />
                  <Button
                    fullWidth
                    loading={isSubmitting}
                    disabled={!mfaCode}
                    onClick={submitMfa}
                  >
                    {t("Verify")}
                  </Button>
                </>
              ) : (
                <Button fullWidth onClick={() => setSetupOpened(true)}>
                  {t("Set up two-factor authentication")}
                </Button>
              )}
            </Stack>
          )}

          {spaces.length > 0 && (
            <div>
              <Text size="sm" fw={500} mb="xs">
                {t("Spaces")}
              </Text>
              <Group gap="xs">
                {spaces.map((space) => (
                  <Button
                    key={space.id}
                    component={Link}
                    to={`/s/${space.slug}`}
                    variant="subtle"
                    size="compact-sm"
                    rightSection={
                      space.requiresStepUp ? <IconLock size={13} /> : undefined
                    }
                  >
                    {space.name}
                  </Button>
                ))}
              </Group>
            </div>
          )}

          <Button
            variant="subtle"
            color="gray"
            loading={isLogoutPending}
            onClick={() => void logout()}
          >
            {t("Logout")}
          </Button>
        </Stack>
      </Paper>

      <MfaSetupModal
        opened={setupOpened}
        onClose={() => setSetupOpened(false)}
        onComplete={() => void refreshAssurance()}
      />
    </Container>
  );
}
