import { Center, Loader } from "@mantine/core";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Error404 } from "@/components/ui/error-404";
import useCurrentUser from "@/features/user/hooks/use-current-user";

export function AuthenticatedError404() {
  const currentUser = useCurrentUser({ skipAuthRedirect: true });
  const { i18n } = useTranslation();

  useEffect(() => {
    const locale = currentUser.data?.user?.locale;
    if (locale) {
      void i18n.changeLanguage(locale === "en" ? "en-US" : locale);
    }
  }, [currentUser.data?.user?.locale, i18n]);

  if (currentUser.isLoading) {
    return (
      <Center h="100vh" role="status">
        <Loader size="sm" />
      </Center>
    );
  }

  return <Error404 />;
}
