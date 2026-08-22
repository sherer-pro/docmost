import { Center, Loader } from "@mantine/core";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthenticatedError404 } from "@/pages/errors/authenticated-error-404";
import { isCloud } from "@/lib/config.ts";
import { useTranslation } from "react-i18next";
import { useRedirectToCloudSelect } from "@/features/cloud/hooks/use-redirect-to-cloud-select.tsx";
import { useTrackOrigin } from "@/hooks/use-track-origin";
import WorkspaceAdminRoute from "@/components/settings/workspace-admin-route.tsx";

const SetupWorkspace = lazy(() => import("@/pages/auth/setup-workspace.tsx"));
const LoginPage = lazy(() => import("@/pages/auth/login"));
const Home = lazy(() => import("@/pages/dashboard/home"));
const Page = lazy(() => import("@/pages/page/page"));
const AccountSettings = lazy(
  () => import("@/pages/settings/account/account-settings"),
);
const WorkspaceMembers = lazy(
  () => import("@/pages/settings/workspace/workspace-members"),
);
const WorkspaceSettings = lazy(
  () => import("@/pages/settings/workspace/workspace-settings"),
);
const Groups = lazy(() => import("@/pages/settings/group/groups"));
const GroupInfo = lazy(() => import("./pages/settings/group/group-info"));
const Spaces = lazy(() => import("@/pages/settings/space/spaces.tsx"));
const AccountPreferences = lazy(
  () => import("@/pages/settings/account/account-preferences.tsx"),
);
const SpaceHome = lazy(() => import("@/pages/space/space-home.tsx"));
const Layout = lazy(() => import("@/components/layouts/global/layout.tsx"));
const InviteSignup = lazy(() => import("@/pages/auth/invite-signup.tsx"));
const ForgotPassword = lazy(() => import("@/pages/auth/forgot-password.tsx"));
const PasswordReset = lazy(() => import("./pages/auth/password-reset"));
const CloudLogin = lazy(() => import("@/features/cloud/pages/cloud-login.tsx"));
const CreateWorkspace = lazy(
  () => import("@/features/cloud/pages/create-workspace.tsx"),
);
const Security = lazy(() => import("@/features/security/pages/security.tsx"));
const SharedPage = lazy(() => import("@/pages/share/shared-page.tsx"));
const Shares = lazy(() => import("@/pages/settings/shares/shares.tsx"));
const ShareLayout = lazy(
  () => import("@/features/share/components/share-layout.tsx"),
);
const ShareRedirect = lazy(() => import("@/pages/share/share-redirect.tsx"));
const SpacesPage = lazy(() => import("@/pages/spaces/spaces.tsx"));
const MfaChallengePage = lazy(() =>
  import("@/features/mfa/pages/mfa-challenge-page").then((module) => ({
    default: module.MfaChallengePage,
  })),
);
const MfaSetupRequiredPage = lazy(() =>
  import("@/features/mfa/pages/mfa-setup-required-page").then((module) => ({
    default: module.MfaSetupRequiredPage,
  })),
);
const SpaceTrash = lazy(() => import("@/pages/space/space-trash.tsx"));
const SpaceDictionary = lazy(
  () => import("@/pages/space/space-dictionary.tsx"),
);
const SpaceTemplates = lazy(() => import("@/pages/space/space-templates.tsx"));
const DatabasePage = lazy(() => import("@/pages/database/database-page.tsx"));
const WorkspaceApiKeysSettings = lazy(
  () => import("@/features/api-key/pages/workspace-api-keys-settings"),
);
const AiIntegrationsSettings = lazy(
  () => import("@/features/ai/pages/ai-integrations-settings.tsx"),
);
const AiSpaceSettingsPage = lazy(
  () => import("@/features/ai/pages/ai-space-settings-page.tsx"),
);

function RouteFallback() {
  return (
    <Center h="100vh">
      <Loader size="sm" />
    </Center>
  );
}

export default function App() {
  useTranslation();
  useRedirectToCloudSelect();
  useTrackOrigin();

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route index element={<Navigate to="/home" />} />
        <Route path={"/login"} element={<LoginPage />} />
        <Route path={"/invites/:invitationId"} element={<InviteSignup />} />
        <Route path={"/forgot-password"} element={<ForgotPassword />} />
        <Route path={"/password-reset"} element={<PasswordReset />} />
        <Route path={"/login/mfa"} element={<MfaChallengePage />} />
        <Route path={"/login/mfa/setup"} element={<MfaSetupRequiredPage />} />

        {!isCloud() && (
          <Route path={"/setup/register"} element={<SetupWorkspace />} />
        )}

        {isCloud() && (
          <>
            <Route path={"/create"} element={<CreateWorkspace />} />
            <Route path={"/select"} element={<CloudLogin />} />
          </>
        )}

        <Route element={<ShareLayout />}>
          <Route
            path={"/share/:shareId/p/:pageSlug"}
            element={<SharedPage />}
          />
          <Route path={"/share/p/:pageSlug"} element={<SharedPage />} />
        </Route>

        <Route path={"/share/:shareId"} element={<ShareRedirect />} />
        <Route element={<Layout />}>
          <Route path={"/home"} element={<Home />} />
          <Route path={"/spaces"} element={<SpacesPage />} />
          <Route path={"/s/:spaceSlug"} element={<SpaceHome />} />
          <Route
            path={"/s/:spaceSlug/dictionary"}
            element={<SpaceDictionary />}
          />
          <Route
            path={"/s/:spaceSlug/templates"}
            element={<SpaceTemplates />}
          />
          <Route path={"/s/:spaceSlug/trash"} element={<SpaceTrash />} />
          <Route
            path={"/s/:spaceSlug/db/:databaseSlug"}
            element={<DatabasePage />}
          />
          <Route path={"/s/:spaceSlug/p/:pageSlug"} element={<Page />} />

          <Route path={"/settings"}>
            <Route path={"account/profile"} element={<AccountSettings />} />
            <Route
              path={"account/preferences"}
              element={<AccountPreferences />}
            />
            <Route path={"members"} element={<WorkspaceMembers />} />
            <Route path={"groups"} element={<Groups />} />
            <Route path={"groups/:groupId"} element={<GroupInfo />} />
            <Route path={"spaces"} element={<Spaces />} />
            <Route path={"sharing"} element={<Shares />} />
            <Route
              path={"ai/spaces/:spaceSlug"}
              element={<AiSpaceSettingsPage />}
            />
            <Route element={<WorkspaceAdminRoute />}>
              <Route
                path={"account/api-keys"}
                element={<Navigate to="/settings/keys/rag" replace />}
              />
              <Route path={"workspace"} element={<WorkspaceSettings />} />
              <Route
                path={"api-keys"}
                element={<Navigate to="/settings/keys/mcp" replace />}
              />
              <Route path={"security"} element={<Security />} />
              <Route
                path={"ai"}
                element={<Navigate to="/settings/ai/spaces" replace />}
              />
              {/* Static segments outrank the dynamic :aiTab route below, so
                  these legacy redirects keep working. */}
              <Route
                path={"ai/rag"}
                element={<Navigate to="/settings/keys/rag" replace />}
              />
              <Route
                path={"ai/mcp"}
                element={<Navigate to="/settings/keys/mcp" replace />}
              />
              <Route path={"ai/:aiTab"} element={<AiIntegrationsSettings />} />
              <Route
                path={"keys"}
                element={<Navigate to="/settings/keys/mcp" replace />}
              />
              <Route
                path={"keys/:keyType"}
                element={<WorkspaceApiKeysSettings />}
              />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<AuthenticatedError404 />} />
      </Routes>
    </Suspense>
  );
}
