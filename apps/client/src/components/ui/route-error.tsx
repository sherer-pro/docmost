import { Button, Center, Paper, Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

export default function RouteError() {
  const { t } = useTranslation();
  return (
    <Center component="main" mih="100dvh" p="md" data-testid="route-error">
      <Paper withBorder radius="md" p="xl" maw={460}>
        <Stack>
          <Title order={1} size="h3">
            {t("Error")}
          </Title>
          <Text>{t("Failed to load page. An error occurred.")}</Text>
          <Button onClick={() => window.location.reload()}>
            {t("Try again")}
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}
