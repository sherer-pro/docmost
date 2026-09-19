import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  NavLink,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconExternalLink,
  IconSettings,
} from "@tabler/icons-react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom";
import { SectionHeader } from "@/components/ui/page-frame";
import { AsyncQueryState } from "@/components/ui/async-query-state";
import { EmptyState } from "@/components/ui/empty-state";
import { useSpaceQuery } from "../../queries/space-query";
import { hasFullSpaceAccess } from "../../permissions/export-access";
import SpaceMembersList from "../space-members";
import AddSpaceMembersModal from "../add-space-members-modal";
import { AiSpaceSettingsSummary } from "@/features/ai/components/ai-space-settings-summary";
import { PageTemplateSpacePolicySettings } from "@/features/page-template/components/page-template-policy-settings";
import {
  SpaceGeneralSettings,
  SpaceDocumentSettings,
  SpaceAccessSettings,
  SpaceNavigationSettings,
  SpaceMaintenanceSettings,
} from "./space-settings-forms";
import { SettingsDraftProvider } from "./settings-draft";
import classes from "./space-settings-page.module.css";

const sections = [
  "general",
  "members",
  "access",
  "documents",
  "templates",
  "navigation",
  "ai",
  "maintenance",
] as const;

export default function SpaceSettingsPage() {
  const { t } = useTranslation();
  const { spaceSlug = "", section = "general" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useSpaceQuery(spaceSlug);
  const user = useAtomValue(userAtom);
  const space = query.data;
  const base = `/settings/spaces/${encodeURIComponent(space?.slug ?? spaceSlug)}`;
  const returnTo =
    typeof location.state?.spacesReturnTo === "string" &&
    /^\/settings\/spaces(?:\?|$)/.test(location.state.spacesReturnTo)
      ? location.state.spacesReturnTo
      : "/settings/spaces";
  if (!sections.includes(section as any))
    return <Navigate to={`${base}/general`} state={location.state} replace />;
  if (
    space &&
    !hasFullSpaceAccess({
      workspaceRole: user?.role,
      spaceRole: space.membership?.role,
    })
  ) {
    return (
      <EmptyState
        icon={IconSettings}
        title={t("page.access.role.none")}
        description={t(
          "This page may have been deleted, moved, or you may not have access.",
        )}
        action={
          <Button component={Link} to={`/s/${space.slug}`}>
            {t("spaceAdmin.openSpace")}
          </Button>
        }
      />
    );
  }
  return (
    <AsyncQueryState
      state={
        space
          ? "ready"
          : query.isLoading
            ? "loading"
            : query.isError
              ? "error"
              : "empty"
      }
      loadingLabel={t("Space settings")}
      errorTitle={t("Could not load spaces")}
      emptyTitle={t("No space found")}
      retryLabel={t("Try again")}
      onRetry={() => void query.refetch()}
    >
      {space && (
        <SettingsDraftProvider key={space.id}>
          {query.isError && (
            <Alert color="orange" mb="md">
              {t("spaceAdmin.refreshFailed")}
            </Alert>
          )}
          <Helmet>
            <title>
              {space.name} · {t("Space settings")}
            </title>
          </Helmet>
          <Anchor component={Link} to={returnTo}>
            <Group gap={4} mb="sm">
              <IconArrowLeft size={16} />
              {t("Spaces")}
            </Group>
          </Anchor>
          <SectionHeader
            title={space.name}
            description={t("spaceAdmin.settingsDescription")}
            actions={
              <Group>
                <Badge
                  color={space.archivedAt ? "gray" : "green"}
                  variant="light"
                  c="var(--mantine-color-text)"
                >
                  {t(space.archivedAt ? "Archived" : "spaceAdmin.active")}
                </Badge>
                <Button
                  component={Link}
                  to={`/s/${space.slug}`}
                  variant="light"
                  rightSection={<IconExternalLink size={16} />}
                >
                  {t("spaceAdmin.openSpace")}
                </Button>
              </Group>
            }
          />
          {space.archivedAt && (
            <Alert color="yellow" mb="md">
              {t("This space is archived and content is read-only.")}
            </Alert>
          )}
          <div className={classes.layout}>
            <nav
              className={classes.navigation}
              aria-label={t("Space settings")}
            >
              {sections.map((item) => (
                <NavLink
                  key={item}
                  component={Link}
                  to={`${base}/${item}`}
                  state={{ ...location.state, spacesReturnTo: returnTo }}
                  active={item === section}
                  aria-current={item === section ? "page" : undefined}
                  label={t(`spaceAdmin.sections.${item}`)}
                />
              ))}
            </nav>
            <Select
              className={classes.mobileNavigation}
              label={t("spaceAdmin.section")}
              value={section}
              allowDeselect={false}
              data={sections.map((value) => ({
                value,
                label: t(`spaceAdmin.sections.${value}`),
              }))}
              onChange={(value) =>
                value &&
                navigate(`${base}/${value}`, {
                  state: { ...location.state, spacesReturnTo: returnTo },
                })
              }
            />
            <section
              key={section}
              className={`${classes.content} ${classes.section}`}
              aria-label={t(`spaceAdmin.sections.${section}`)}
            >
              <Text component="h2" size="lg" fw={600} mt={0} mb="lg">
                {t(`spaceAdmin.sections.${section}`)}
              </Text>
              {section === "general" && <SpaceGeneralSettings space={space} />}
              {section === "members" && (
                <Stack>
                  <Group justify="flex-end">
                    <AddSpaceMembersModal spaceId={space.id} />
                  </Group>
                  <SpaceMembersList spaceId={space.id} />
                </Stack>
              )}
              {section === "access" && <SpaceAccessSettings space={space} />}
              {section === "documents" && (
                <SpaceDocumentSettings space={space} />
              )}
              {section === "templates" && (
                <Stack>
                  <PageTemplateSpacePolicySettings spaceId={space.id} />
                  <Anchor component={Link} to={`/s/${space.slug}/templates`}>
                    {t("spaceAdmin.openTemplates")}
                  </Anchor>
                </Stack>
              )}
              {section === "navigation" && (
                <SpaceNavigationSettings space={space} />
              )}
              {section === "ai" && (
                <AiSpaceSettingsSummary
                  spaceId={space.id}
                  spaceSlug={space.slug}
                  fromSpaceSettings
                />
              )}
              {section === "maintenance" && (
                <SpaceMaintenanceSettings space={space} />
              )}
            </section>
          </div>
        </SettingsDraftProvider>
      )}
    </AsyncQueryState>
  );
}
