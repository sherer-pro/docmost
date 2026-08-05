import {
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconLock, IconMapOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config.ts";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import useCurrentUser from "@/features/user/hooks/use-current-user.ts";
import { hasFullSpaceAccess } from "@/features/space/permissions/export-access.ts";
import { UserRole } from "@/lib/types.ts";
import { useSpaceQuery } from "@/features/space/queries/space-query.ts";
import {
  AiSpaceSettings,
  type AiSpaceSettingsSection,
} from "@/features/ai/components/ai-space-settings.tsx";
import classes from "./ai-space-settings-page.module.css";

const SECTIONS: Exclude<AiSpaceSettingsSection, "all">[] = [
  "overview",
  "identity",
  "content",
  "model",
  "behavior",
  "agent",
  "profiles",
  "tools",
  "externalTools",
  "retrieval",
  "limits",
];

export default function AiSpaceSettingsPage() {
  const { t } = useTranslation();
  const { spaceSlug = "" } = useParams();
  const spaceQuery = useSpaceQuery(spaceSlug);
  const currentUserQuery = useCurrentUser();
  const [section, setSection] =
    useState<Exclude<AiSpaceSettingsSection, "all">>("overview");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const preventUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  const chooseSection = (next: Exclude<AiSpaceSettingsSection, "all">) => {
    if (
      dirty &&
      !window.confirm(t("ai.integrations.unsavedNavigationConfirm"))
    ) {
      return;
    }
    setDirty(false);
    setSection(next);
  };

  if (spaceQuery.isLoading || currentUserQuery.isLoading) {
    return (
      <Group justify="center" py="xl" role="status">
        <Loader size="sm" />
      </Group>
    );
  }
  if (spaceQuery.isError || !spaceQuery.data) {
    return (
      <EmptyState
        icon={IconMapOff}
        title={t("ai.integrations.spaceNotFound")}
        description={t("This page may have been deleted, moved, or you may not have access.")}
        action={
          <Button component={Link} to="/home" variant="light">
            {t("Take me back to homepage")}
          </Button>
        }
      />
    );
  }

  const space = spaceQuery.data;
  const workspaceRole = currentUserQuery.data?.user?.role;
  const fullSpaceAccess = hasFullSpaceAccess({
    workspaceRole,
    spaceRole: space.membership?.role,
  });
  const isWorkspaceAdmin =
    workspaceRole === UserRole.OWNER || workspaceRole === UserRole.ADMIN;
  const backPath = isWorkspaceAdmin
    ? "/settings/ai/spaces"
    : `/s/${space.slug}`;

  if (!fullSpaceAccess) {
    return (
      <EmptyState
        icon={IconLock}
        title={t("page.access.role.none")}
        description={t("This page may have been deleted, moved, or you may not have access.")}
        action={
          <Button component={Link} to={`/s/${space.slug}`} variant="light">
            {t("ai.integrations.backToSpace")}
          </Button>
        }
      />
    );
  }
  const options = SECTIONS.map((value) => ({
    value,
    label: t(`ai.integrations.section.${value}`),
  }));

  return (
    <Stack gap="lg" className={classes.page}>
      <Helmet>
        <title>
          {space.name} · {t("ai.integrations.title")} - {getAppName()}
        </title>
      </Helmet>
      <div>
        <Button
          component={Link}
          to={backPath}
          variant="subtle"
          size="compact-sm"
          leftSection={<IconArrowLeft size={15} />}
          px={0}
        >
          {t(
            isWorkspaceAdmin
              ? "ai.integrations.backToOverview"
              : "ai.integrations.backToSpace",
          )}
        </Button>
        <Group mt="xs" gap="xs">
          <Title order={1} size="h2">
            {space.name}
          </Title>
          {dirty && (
            <Badge color="orange" variant="light">
              {t("ai.integrations.unsaved")}
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          {t("ai.integrations.spaceSettingsDescription")}
        </Text>
      </div>

      <Select
        className={classes.mobileSectionSelect}
        label={t("ai.integrations.sectionLabel")}
        data={options}
        value={section}
        allowDeselect={false}
        onChange={(value) =>
          value &&
          chooseSection(value as Exclude<AiSpaceSettingsSection, "all">)
        }
      />

      <div className={classes.layout}>
        <Paper
          component="nav"
          withBorder
          radius="md"
          p="xs"
          className={classes.sectionNav}
          aria-label={t("ai.integrations.sectionLabel")}
        >
          <Stack gap={2}>
            {options.map((option) => (
              <Button
                key={option.value}
                variant={section === option.value ? "light" : "subtle"}
                color={section === option.value ? "blue" : "gray"}
                justify="flex-start"
                aria-current={section === option.value ? "page" : undefined}
                onClick={() =>
                  chooseSection(
                    option.value as Exclude<AiSpaceSettingsSection, "all">,
                  )
                }
              >
                {option.label}
              </Button>
            ))}
          </Stack>
        </Paper>
        <main className={classes.content}>
          <AiSpaceSettings
            key={section}
            spaceId={space.id}
            section={section}
            onDirtyChange={setDirty}
          />
        </main>
      </div>
    </Stack>
  );
}
