import * as React from "react";
import * as z from "zod";

import { useForm } from "@mantine/form";
import {
  Container,
  Title,
  TextInput,
  Button,
  PasswordInput,
  Box,
  Stack,
} from "@mantine/core";
import { zodResolver } from "mantine-form-zod-resolver";
import { useParams, useSearchParams } from "react-router-dom";
import { IRegister } from "@/features/auth/types/auth.types";
import useAuth from "@/features/auth/hooks/use-auth";
import classes from "@/features/auth/components/auth.module.css";
import { useGetInvitationQuery } from "@/features/workspace/queries/workspace-query.ts";
import { useRedirectIfAuthenticated } from "@/features/auth/hooks/use-redirect-if-authenticated.ts";
import { useTranslation } from "react-i18next";
import SsoLogin from "@/features/security/components/sso-login.tsx";
import { isPasswordWithinUtf8Limit } from "@/features/auth/utils/password-validation.ts";

const createFormSchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().trim().min(1),
    password: z
      .string()
      .min(8)
      .refine(isPasswordWithinUtf8Limit, {
        message: t("Password is too long"),
      }),
  });

type FormValues = z.infer<ReturnType<typeof createFormSchema>>;

export function InviteSignUpForm() {
  const { t } = useTranslation();
  const formSchema = createFormSchema(t);
  const params = useParams();
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get("token") ?? "";

  const { data: invitation, isError } = useGetInvitationQuery(
    params?.invitationId,
    invitationToken,
  );
  const { invitationSignup, isLoading } = useAuth();
  useRedirectIfAuthenticated();

  const form = useForm<FormValues>({
    validate: zodResolver(formSchema),
    initialValues: {
      name: "",
      password: "",
    },
  });

  async function onSubmit(data: IRegister) {
    await invitationSignup({
      invitationId: invitation.id,
      name: data.name,
      password: data.password,
      token: invitationToken,
    });
  }

  if (!invitationToken || isError) {
    return <div>{t("invalid invitation link")}</div>;
  }

  if (!invitation) {
    return <div></div>;
  }

  return (
    <Container size={420} className={classes.container}>
      <Box p="xl" className={classes.containerBox}>
        <Title order={2} ta="center" fw={500} mb="md">
          {t("Join the workspace")}
        </Title>

        <SsoLogin />

        {(invitation.passwordAllowed ?? !invitation.enforceSso) && (
          <Stack align="stretch" justify="center" gap="xl">
            <form onSubmit={form.onSubmit(onSubmit)}>
              <TextInput
                id="name"
                name="name"
                autoComplete="name"
                type="text"
                label={t("Name")}
                placeholder={t("enter your full name")}
                variant="filled"
                {...form.getInputProps("name")}
              />

              <TextInput
                id="email"
                name="email"
                autoComplete="email"
                type="email"
                label={t("Email")}
                value={invitation.email}
                disabled
                variant="filled"
                mt="md"
              />

              <PasswordInput
                name="password"
                autoComplete="new-password"
                label={t("Password")}
                placeholder={t("Your password")}
                variant="filled"
                mt="md"
                {...form.getInputProps("password")}
              />
              <Button type="submit" fullWidth mt="xl" loading={isLoading}>
                {t("Sign Up")}
              </Button>
            </form>
          </Stack>
        )}
      </Box>
    </Container>
  );
}
