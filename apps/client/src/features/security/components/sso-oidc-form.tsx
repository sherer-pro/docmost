import React from "react";
import { z } from "zod";
import { useForm, zodResolver } from "@mantine/form";
import {
  Box,
  PasswordInput,
  Stack,
  TextInput,
} from "@mantine/core";
import { buildCallbackUrl } from "@/features/security/sso.utils.ts";
import {
  IAuthProvider,
  IUpdateAuthProvider,
} from "@/features/security/types/security.types.ts";
import CopyTextButton from "@/components/common/copy.tsx";
import { useTranslation } from "react-i18next";
import { useUpdateSsoProviderMutation } from "@/features/security/queries/security-query.ts";
import { SsoCommonControls } from "@/features/security/components/sso-common-controls.tsx";

const ssoSchema = z.object({
  name: z.string().min(1, "Display name is required"),
  oidcIssuer: z.string().url(),
  oidcClientId: z.string().min(1, "Client id is required"),
  oidcClientSecret: z.string().min(1, "Client secret is required"),
  isEnabled: z.boolean(),
  allowSignup: z.boolean(),
  groupSync: z.boolean(),
});

type SSOFormValues = z.infer<typeof ssoSchema>;

interface SsoFormProps {
  provider: IAuthProvider;
  onClose?: () => void;
}
export function SsoOIDCForm({ provider, onClose }: SsoFormProps) {
  const { t } = useTranslation();
  const updateSsoProviderMutation = useUpdateSsoProviderMutation();

  const form = useForm<SSOFormValues>({
    initialValues: {
      name: provider.name || "",
      oidcIssuer: provider.oidcIssuer || "",
      oidcClientId: provider.oidcClientId || "",
      oidcClientSecret: provider.oidcClientSecret || "",
      isEnabled: provider.isEnabled,
      allowSignup: provider.allowSignup,
      groupSync: provider.groupSync || false,
    },
    validate: zodResolver(ssoSchema),
  });

  const callbackUrl = buildCallbackUrl({
    providerId: provider.id,
    type: provider.type,
  });

  const handleSubmit = async (values: SSOFormValues) => {
    const ssoData: IUpdateAuthProvider = {
      providerId: provider.id,
    };
    if (form.isDirty("name")) {
      ssoData.name = values.name;
    }
    if (form.isDirty("oidcIssuer")) {
      ssoData.oidcIssuer = values.oidcIssuer;
    }
    if (form.isDirty("oidcClientId")) {
      ssoData.oidcClientId = values.oidcClientId;
    }
    if (form.isDirty("oidcClientSecret")) {
      ssoData.oidcClientSecret = values.oidcClientSecret;
    }
    if (form.isDirty("isEnabled")) {
      ssoData.isEnabled = values.isEnabled;
    }
    if (form.isDirty("allowSignup")) {
      ssoData.allowSignup = values.allowSignup;
    }
    if (form.isDirty("groupSync")) {
      ssoData.groupSync = values.groupSync;
    }

    await updateSsoProviderMutation.mutateAsync(ssoData);
    form.resetDirty();
    onClose?.();
  };

  return (
    <Box maw={600} mx="auto">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label={t("Display name")}
            placeholder={t("e.g Google SSO")}
            data-autofocus
            {...form.getInputProps("name")}
          />
          <TextInput
            label={t("Callback URL")}
            variant="filled"
            value={callbackUrl}
            pointer
            readOnly
            rightSection={<CopyTextButton text={callbackUrl} />}
          />
          <TextInput
            label={t("Issuer URL")}
            description={t("Enter your OIDC issuer URL")}
            placeholder={t("e.g https://accounts.google.com/")}
            {...form.getInputProps("oidcIssuer")}
          />
          <TextInput
            label={t("Client ID")}
            description={t("Enter your OIDC ClientId")}
            placeholder={t("e.g 292085223830.apps.googleusercontent.com")}
            {...form.getInputProps("oidcClientId")}
          />
          <PasswordInput
            label={t("Client Secret")}
            description={t("Enter your OIDC Client Secret")}
            placeholder={t("e.g OCSPX-zVCkotEPGRnJA1XKUrbgjlf7PQQ-")}
            {...form.getInputProps("oidcClientSecret")}
          />

          <SsoCommonControls
            form={form}
            isSaving={updateSsoProviderMutation.isPending}
          />
        </Stack>
      </form>
    </Box>
  );
}
