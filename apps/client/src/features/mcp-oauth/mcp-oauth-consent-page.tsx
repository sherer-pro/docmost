import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { IconPlugConnected } from "@tabler/icons-react";
import { getSpaces } from "@/features/space/services/space-service";
import type { ISpace } from "@/features/space/types/space.types";
import { EmptyState } from "@/components/ui/empty-state";
import { AuthenticationStepUp } from "@/features/security/components/authentication-step-up";
import type { AuthenticationAssuranceRequiredError } from "@docmost/api-contract";
import { decideMcpOAuthConsent, getMcpOAuthConsent } from "./mcp-oauth-service";

export default function McpOAuthConsentPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const requestId = params.get("request") ?? "";
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<ISpace | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 200);
  const consent = useQuery({
    queryKey: ["mcp-oauth-consent", requestId],
    queryFn: () => getMcpOAuthConsent(requestId),
    retry: false,
    staleTime: 0,
  });
  const spaces = useQuery({
    queryKey: ["spaces", "mcp-oauth-consent", debouncedSearch],
    queryFn: () => getSpaces({ query: debouncedSearch, limit: 100 }),
  });
  const decision = useMutation({
    mutationFn: (allow: boolean) =>
      decideMcpOAuthConsent({
        requestId,
        allow,
        ...(allow && spaceId ? { spaceId } : {}),
      }),
    onSuccess: ({ redirectUri }) => window.location.assign(redirectUri),
  });
  const assuranceError = (decision.error as any)?.response?.data as
    | AuthenticationAssuranceRequiredError
    | undefined;
  const selected = selectedSpace;
  const availableSpaces = [
    ...(selectedSpace ? [selectedSpace] : []),
    ...(spaces.data?.items.filter((space) => space.id !== selectedSpace?.id) ??
      []),
  ];
  if (assuranceError?.code === "AUTHENTICATION_ASSURANCE_REQUIRED" && selected)
    return (
      <AuthenticationStepUp
        requirements={assuranceError.requirements}
        spaceSlug={selected.slug}
        spaces={spaces.data?.items}
      />
    );

  return (
    <Paper p="lg" maw={720} mx="auto" my="xl" withBorder>
      <Helmet>
        <title>{t("mcpOAuth.consentTitle")}</title>
        <meta name="referrer" content="no-referrer" />
      </Helmet>
      <Stack>
        <Title order={2}>{t("mcpOAuth.consentTitle")}</Title>
        {consent.isLoading ? (
          <Skeleton height={180} />
        ) : consent.isError || !consent.data ? (
          <EmptyState
            icon={IconPlugConnected}
            title={t("mcpOAuth.expired")}
            action={
              <Button onClick={() => consent.refetch()}>
                {t("mcpOAuth.reload")}
              </Button>
            }
          />
        ) : (
          <>
            <Title order={3}>{consent.data.clientName}</Title>
            <Alert color="yellow">{t("mcpOAuth.unverified")}</Alert>
            <Text>{t("mcpOAuth.scopeRead")}</Text>
            <Text size="sm" c="dimmed">
              {t("mcpOAuth.sessionBound")}
            </Text>
            <Text size="sm" style={{ overflowWrap: "anywhere" }}>
              {t("mcpOAuth.redirect")}: {consent.data.redirectUri}
            </Text>
            <Select
              label={t("mcpOAuth.space")}
              placeholder={t("mcpOAuth.space")}
              data={
                availableSpaces
                  .filter((space) => !space.archivedAt)
                  .map((space) => ({ value: space.id, label: space.name })) ??
                []
              }
              value={spaceId}
              onChange={(value) => {
                setSpaceId(value);
                setSelectedSpace(
                  availableSpaces.find((space) => space.id === value) ?? null,
                );
              }}
              searchable
              searchValue={search}
              onSearchChange={setSearch}
              filter={({ options }) => options}
              nothingFoundMessage={t("mcpOAuth.emptySpaces")}
            />
            {(decision.isError || spaces.isError) && (
              <Alert color="red">{t("mcpOAuth.failed")}</Alert>
            )}
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={decision.isPending}
                onClick={() => decision.mutate(false)}
              >
                {t("mcpOAuth.deny")}
              </Button>
              <Button
                disabled={!spaceId || decision.isPending || spaces.isError}
                loading={decision.isPending}
                onClick={() => decision.mutate(true)}
              >
                {t("mcpOAuth.allow")}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
