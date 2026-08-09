import * as z from "zod";
import { useForm, zodResolver } from "@mantine/form";
import useAuth from "@/features/auth/hooks/use-auth";
import { ILogin } from "@/features/auth/types/auth.types";
import {
  Container,
  Title,
  TextInput,
  Button,
  PasswordInput,
  Box,
  Anchor,
  Group,
} from "@mantine/core";
import classes from "./auth.module.css";
import { useRedirectIfAuthenticated } from "@/features/auth/hooks/use-redirect-if-authenticated.ts";
import { Link, useSearchParams } from "react-router-dom";
import APP_ROUTE from "@/lib/app-route.ts";
import { useTranslation } from "react-i18next";
import SsoLogin from "@/features/security/components/sso-login.tsx";
import { useWorkspacePublicDataQuery } from "@/features/workspace/queries/workspace-query.ts";
import { Error404 } from "@/components/ui/error-404.tsx";
import React from "react";
import { sanitizeRelativeReturnTo } from "@/features/auth/utils/return-to.ts";
import { isPasswordWithinUtf8Limit } from "@/features/auth/utils/password-validation.ts";

const createFormSchema = (t: (key: string) => string) =>
  z.object({
    email: z
      .string()
      .min(1, { message: t("Email is required") })
      .email({ message: t("Invalid email address") }),
    password: z
      .string()
      .min(1, { message: t("Password is required") })
      .refine(isPasswordWithinUtf8Limit, {
        message: t("Password is too long"),
      }),
  });

export function LoginForm() {
  const { t } = useTranslation();
  const formSchema = createFormSchema(t);
  const { signIn, isLoading } = useAuth();
  useRedirectIfAuthenticated();
  const [searchParams] = useSearchParams();
  const spaceSlug = searchParams.get("spaceSlug") || undefined;
  const requestedReturnTo = searchParams.get("returnTo");
  const returnTo = requestedReturnTo
    ? sanitizeRelativeReturnTo(requestedReturnTo, APP_ROUTE.HOME)
    : undefined;
  const {
    data,
    isLoading: isDataLoading,
    isError,
    error,
  } = useWorkspacePublicDataQuery(spaceSlug);

  const form = useForm<ILogin>({
    validate: zodResolver(formSchema),
    initialValues: {
      email: "",
      password: "",
      spaceSlug,
    },
  });

  async function onSubmit(data: ILogin) {
    await signIn(data);
  }

  if (isDataLoading) {
   return null;
  }

  if (isError && error?.["response"]?.status === 404) {
    return <Error404 />;
  }

  return (
    <Container size={420} className={classes.container}>
      <Box p="xl" className={classes.containerBox}>
        <Title order={1} size="h2" ta="center" fw={500} mb="md">
          {t("Login")}
        </Title>

        <SsoLogin spaceSlug={spaceSlug} returnTo={returnTo} />

        {!data?.enforceSso && (
          <>
            <form onSubmit={form.onSubmit(onSubmit)}>
              <TextInput
                id="email"
                name="email"
                autoComplete="email"
                type="email"
                label={t("Email")}
                placeholder="email@example.com"
                variant="filled"
                {...form.getInputProps("email")}
              />

              <PasswordInput
                name="password"
                autoComplete="current-password"
                label={t("Password")}
                placeholder={t("Your password")}
                variant="filled"
                mt="md"
                {...form.getInputProps("password")}
              />

              <Group justify="flex-end" mt="sm">
                <Anchor
                  to={`${APP_ROUTE.AUTH.FORGOT_PASSWORD}${
                    spaceSlug
                      ? `?spaceSlug=${encodeURIComponent(spaceSlug)}`
                      : ""
                  }`}
                  component={Link}
                  underline="never"
                  size="sm"
                >
                  {t("Forgot your password?")}
                </Anchor>
              </Group>

              <Button type="submit" fullWidth mt="md" loading={isLoading}>
                {t("Sign In")}
              </Button>
            </form>
          </>
        )}
      </Box>
    </Container>
  );
}
