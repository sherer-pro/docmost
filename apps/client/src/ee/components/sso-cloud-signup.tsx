import { Button, Divider, Stack } from "@mantine/core";
import { getGoogleSignupUrl } from "@/ee/security/sso.utils.ts";
import { GoogleIcon } from "@/components/icons/google-icon.tsx";
import { useTranslation } from "react-i18next";

export default function SsoCloudSignup() {
  const { t } = useTranslation();
  const handleSsoLogin = () => {
    window.location.href = getGoogleSignupUrl();
  };

  return (
    <>
      <Stack align="stretch" justify="center" gap="sm">
        <Button
          onClick={handleSsoLogin}
          leftSection={<GoogleIcon size={16} />}
          variant="default"
          fullWidth
        >
          {t("Signup with Google")}
        </Button>
      </Stack>
      <Divider my="xs" label={t("OR")} labelPosition="center" />
    </>
  );
}
