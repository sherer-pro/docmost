import React, { useState } from "react";
import { Modal, TextInput, PasswordInput, Button, Stack } from "@mantine/core";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import { z } from "zod";
import { notifications } from "@mantine/notifications";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { IPublicAuthProvider } from "@/features/security/types/security.types";
import APP_ROUTE from "@/lib/app-route";
import { ldapLogin } from "@/features/security/services/ldap-auth-service";
import { sanitizeRelativeReturnTo } from "@/features/auth/utils/return-to";

const createFormSchema = (t: (key: string) => string) =>
  z.object({
    username: z.string().min(1, { message: t("Username is required") }),
    password: z.string().min(1, { message: t("Password is required") }),
  });

interface LdapLoginModalProps {
  opened: boolean;
  onClose: () => void;
  provider: IPublicAuthProvider;
  spaceSlug?: string;
  returnTo?: string;
}

export function LdapLoginModal({
  opened,
  onClose,
  provider,
  spaceSlug,
  returnTo,
}: LdapLoginModalProps) {
  const { t } = useTranslation();
  const formSchema = createFormSchema(t);
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeReturnTo = sanitizeRelativeReturnTo(returnTo, APP_ROUTE.HOME);

  const form = useForm({
    validate: zodResolver(formSchema),
    initialValues: {
      username: "",
      password: "",
    },
  });

  const handleSubmit = async (values: {
    username: string;
    password: string;
  }) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await ldapLogin({
        username: values.username,
        password: values.password,
        providerId: provider.id,
        spaceSlug,
      });

      // Handle MFA like the regular login
      const authParams = new URLSearchParams();
      if (spaceSlug) authParams.set("spaceSlug", spaceSlug);
      if (returnTo) authParams.set("returnTo", safeReturnTo);
      const authQuery = authParams.size ? `?${authParams}` : "";
      if (response?.userHasMfa) {
        onClose();
        navigate(`${APP_ROUTE.AUTH.MFA_CHALLENGE}${authQuery}`);
      } else if (response?.requiresMfaSetup) {
        onClose();
        navigate(`${APP_ROUTE.AUTH.MFA_SETUP_REQUIRED}${authQuery}`);
      } else {
        onClose();
        navigate(safeReturnTo);
      }
    } catch (err: any) {
      setIsLoading(false);
      const errorMessage =
        err.response?.data?.message || "Authentication failed";
      setError(errorMessage);

      notifications.show({
        message: errorMessage,
        color: "red",
      });
    }
  };

  const handleClose = () => {
    form.reset();
    setError(null);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("LDAP Login - {{provider}}", { provider: provider.name })}
      size="md"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            id="ldap-username"
            type="text"
            label={t("LDAP username")}
            placeholder={t("Enter your LDAP username")}
            variant="filled"
            disabled={isLoading}
            data-autofocus
            {...form.getInputProps("username")}
          />

          <PasswordInput
            label={t("LDAP password")}
            placeholder={t("Enter your LDAP password")}
            variant="filled"
            disabled={isLoading}
            {...form.getInputProps("password")}
          />

          <Button type="submit" fullWidth mt="md" loading={isLoading}>
            {t("Sign in with LDAP")}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
