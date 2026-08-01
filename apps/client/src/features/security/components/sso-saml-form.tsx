import React from "react";
import { z } from "zod";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import {
  Box,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  buildCallbackUrl,
  buildSamlEntityId,
} from "@/features/security/sso.utils.ts";
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
  samlUrl: z.string().url(),
  samlCertificate: z.string().min(1, "SAML Idp Certificate is required"),
  isEnabled: z.boolean(),
  allowSignup: z.boolean(),
  groupSync: z.boolean(),
});

type SSOFormValues = z.infer<typeof ssoSchema>;

interface SsoFormProps {
  provider: IAuthProvider;
  onClose?: () => void;
}
export function SsoSamlForm({ provider, onClose }: SsoFormProps) {
  const { t } = useTranslation();
  const updateSsoProviderMutation = useUpdateSsoProviderMutation();

  const form = useForm<SSOFormValues>({
    initialValues: {
      name: provider.name || "",
      samlUrl: provider.samlUrl || "",
      samlCertificate: provider.samlCertificate || "",
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

  const samlEntityId = buildSamlEntityId(provider.id);

  const handleSubmit = async (values: SSOFormValues) => {
    const ssoData: IUpdateAuthProvider = {
      providerId: provider.id,
    };
    if (form.isDirty("name")) {
      ssoData.name = values.name;
    }
    if (form.isDirty("samlUrl")) {
      ssoData.samlUrl = values.samlUrl;
    }
    if (form.isDirty("samlCertificate")) {
      ssoData.samlCertificate = values.samlCertificate;
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
            placeholder={t("e.g Azure Entra")}
            data-autofocus
            {...form.getInputProps("name")}
          />
          <TextInput
            label={t("Entity ID")}
            variant="filled"
            value={buildSamlEntityId(provider.id)}
            rightSection={<CopyTextButton text={samlEntityId} />}
            pointer
            readOnly
          />
          <TextInput
            label={t("Callback URL (ACS)")}
            variant="filled"
            value={callbackUrl}
            pointer
            readOnly
            rightSection={<CopyTextButton text={callbackUrl} />}
          />
          <TextInput
            label={t("IDP Login URL")}
            description={t("Enter your IDP login URL")}
            placeholder={t(
              "e.g https://login.microsoftonline.com/7d6246d1-273b-4981-ad1e-e7bb27b86569/saml2",
            )}
            {...form.getInputProps("samlUrl")}
          />
          <Textarea
            label={t("IDP Certificate")}
            description={t("Enter your IDP certificate")}
            placeholder={t("-----BEGIN CERTIFICATE-----")}
            autosize
            minRows={3}
            maxRows={5}
            {...form.getInputProps("samlCertificate")}
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
