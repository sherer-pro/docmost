import { UserProvider } from "@/features/user/user-provider.tsx";
import { Outlet, useParams } from "react-router-dom";
import GlobalAppShell from "@/components/layouts/global/global-app-shell.tsx";
import { PosthogUser } from "@/features/telemetry/components/posthog-user.tsx";
import { isCloud } from "@/lib/config.ts";
import { SearchSpotlight } from "@/features/search/components/search-spotlight.tsx";
import {
  useGetSpacesQuery,
  useSpacePolicyContextQuery,
} from "@/features/space/queries/space-query.ts";
import { useAtomValue } from "jotai";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { AuthenticationStepUp } from "@/features/security/components/authentication-step-up.tsx";
import type {
  AuthenticationAssuranceRequiredError,
  AuthenticationRequirement,
} from "@docmost/api-contract";
import { Center, Loader } from "@mantine/core";
import { useEffect, useState } from "react";
import { AUTHENTICATION_ASSURANCE_REQUIRED_EVENT } from "@/lib/api-client.ts";

function AuthenticatedLayout() {
  const { spaceSlug } = useParams();
  const currentUser = useAtomValue(currentUserAtom);
  const { data: spaces, isLoading: spacesLoading } = useGetSpacesQuery({
    limit: 100,
  });
  const { data: spaceContext, isLoading: spaceContextLoading } =
    useSpacePolicyContextQuery(spaceSlug);
  const [routeAssuranceError, setRouteAssuranceError] =
    useState<AuthenticationAssuranceRequiredError | null>(null);
  const assurance = currentUser?.authenticationAssurance;
  const workspaceMissing =
    assurance?.workspaceMissingRequirements ?? [];
  const spaceMissing: AuthenticationRequirement[] = [];

  if (spaceContext?.policy.effective.enforceSso && !assurance?.ssoVerified) {
    spaceMissing.push("sso");
  }
  if (spaceContext?.policy.effective.enforceMfa && !assurance?.mfaVerified) {
    spaceMissing.push("mfa");
  }

  const eventMissing = (routeAssuranceError?.requirements ?? []).filter(
    (requirement) =>
      requirement === "sso"
        ? !assurance?.ssoVerified
        : !assurance?.mfaVerified,
  );

  useEffect(() => {
    setRouteAssuranceError(null);
  }, [spaceSlug]);

  useEffect(() => {
    const handleAssuranceRequired = (event: Event) => {
      const detail = (event as CustomEvent<AuthenticationAssuranceRequiredError>)
        .detail;
      const appliesToRoute = spaceSlug
        ? detail.scope === "space" && detail.spaceId === spaceContext?.id
        : detail.scope === "workspace";
      if (appliesToRoute) {
        setRouteAssuranceError(detail);
      }
    };

    window.addEventListener(
      AUTHENTICATION_ASSURANCE_REQUIRED_EVENT,
      handleAssuranceRequired,
    );
    return () =>
      window.removeEventListener(
        AUTHENTICATION_ASSURANCE_REQUIRED_EVENT,
        handleAssuranceRequired,
      );
  }, [spaceContext?.id, spaceSlug]);

  const requirements = spaceSlug
    ? [...new Set([...spaceMissing, ...eventMissing])]
    : workspaceMissing;
  const restricted = workspaceMissing.length > 0;

  if (!currentUser) {
    return null;
  }

  if (spacesLoading || (spaceSlug && spaceContextLoading)) {
    return (
      <Center h="100vh">
        <Loader size="sm" />
      </Center>
    );
  }

  if (requirements.length > 0) {
    return (
      <AuthenticationStepUp
        requirements={requirements}
        spaceSlug={spaceSlug}
        spaces={spaces?.items}
      />
    );
  }

  return (
    <>
      <GlobalAppShell restricted={restricted}>
        <Outlet />
      </GlobalAppShell>
      {isCloud() && !restricted && <PosthogUser />}
      {!restricted && <SearchSpotlight spaceId={spaceContext?.id} />}
    </>
  );
}

export default function Layout() {
  return (
    <UserProvider>
      <AuthenticatedLayout />
    </UserProvider>
  );
}
