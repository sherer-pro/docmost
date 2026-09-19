import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconExternalLink, IconSearch } from "@tabler/icons-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  SpaceAdministrationResponse,
  SpaceArchiveFilter,
} from "@docmost/api-contract";
import api from "@/lib/api-client";
import { AsyncQueryState } from "@/components/ui/async-query-state";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import { AvatarIconType } from "@/features/attachments/types/attachment.types";
import Paginate from "@/components/common/paginate";
import tableClasses from "@/components/ui/responsive-table.module.css";
import {
  getResponsivePrimaryCellProps,
  getResponsiveMetaCellProps,
  getResponsiveActionCellProps,
} from "@/components/ui/responsive-table";

const scrollPositions = new Map<string, number>();
const scrollStoragePrefix = "docmost:space-administration:scroll:";
export default function SpaceList() {
  const { t } = useTranslation();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = params.get("query") ?? "";
  const status: SpaceArchiveFilter =
    params.get("status") === "all"
      ? "all"
      : params.get("status") === "archived"
        ? "archived"
        : "active";
  const [search, setSearch] = useState(query);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    setSearch(query);
  }, [query]);
  useEffect(() => {
    if (composing || search === query) return;
    const timeout = window.setTimeout(() => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete("cursor");
          next.delete("beforeCursor");
          if (search.trim()) next.set("query", search.trim());
          else next.delete("query");
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search, query, composing, setParams]);
  const request = {
    query,
    status,
    limit: 20,
    cursor: params.get("cursor") || undefined,
    beforeCursor: params.get("beforeCursor") || undefined,
  };
  const result = useQuery({
    queryKey: ["spaces", "administration", request],
    refetchOnMount: true,
    queryFn: async () =>
      (
        await api.get<SpaceAdministrationResponse>("/spaces/administration", {
          params: request,
        })
      ).data,
  });
  const positionKey = location.pathname + location.search;
  const restoredPosition = useRef<string | null>(null);
  useEffect(() => {
    const record = () => {
      if (restoredPosition.current === positionKey)
        scrollPositions.set(positionKey, window.scrollY);
    };
    const persist = () => {
      const position = scrollPositions.get(positionKey);
      if (position === undefined) return;
      try {
        sessionStorage.setItem(
          scrollStoragePrefix + positionKey,
          String(position),
        );
      } catch {
        /* Storage may be unavailable. */
      }
    };
    window.addEventListener("scroll", record, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      persist();
      window.removeEventListener("scroll", record);
      window.removeEventListener("pagehide", persist);
    };
  }, [positionKey]);
  useEffect(() => {
    if (!result.data || restoredPosition.current === positionKey) return;
    restoredPosition.current = positionKey;
    let position = scrollPositions.get(positionKey);
    if (position === undefined) {
      try {
        position = Number(
          sessionStorage.getItem(scrollStoragePrefix + positionKey),
        );
      } catch {
        /* Use the initial position without storage. */
      }
    }
    position =
      typeof position === "number" && Number.isFinite(position) && position >= 0
        ? position
        : 0;
    scrollPositions.set(positionKey, position);
    window.scrollTo(0, position);
  }, [positionKey, result.data]);
  const page = (cursor: string | null, before = false) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("cursor");
      next.delete("beforeCursor");
      if (cursor) next.set(before ? "beforeCursor" : "cursor", cursor);
      return next;
    });
  const items = result.data?.items ?? [];
  const state = result.isLoading
    ? "loading"
    : result.isError
      ? "error"
      : !items.length
        ? "empty"
        : "ready";
  return (
    <Stack>
      <Group align="end">
        <TextInput
          style={{ flex: "1 1 240px" }}
          label={t("spaceAdmin.searchLabel")}
          placeholder={t("spaceAdmin.searchPlaceholder")}
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
        />
        <Select
          label={t("spaceAdmin.status")}
          value={status}
          allowDeselect={false}
          data={(["active", "archived", "all"] as const).map((value) => ({
            value,
            label: t(`spaceAdmin.filter.${value}`),
          }))}
          onChange={(value) => {
            if (!value) return;
            setParams((previous) => {
              const next = new URLSearchParams(previous);
              next.set("status", value);
              next.delete("cursor");
              next.delete("beforeCursor");
              return next;
            });
          }}
        />
      </Group>
      <AsyncQueryState
        state={state}
        loadingLabel={t("Spaces")}
        errorTitle={t("Could not load spaces")}
        emptyTitle={t(
          query
            ? "spaceAdmin.noResults"
            : status === "all"
              ? "spaceAdmin.noSpacesYet"
              : "spaceAdmin.noSpaces",
        )}
        retryLabel={t("Retry")}
        onRetry={() => void result.refetch()}
      >
        <Table.ScrollContainer
          minWidth={700}
          className={tableClasses.responsiveScroll}
        >
          <Table
            className={tableClasses.responsiveTable}
            verticalSpacing="md"
            highlightOnHover
          >
            <Table.Thead>
              <Table.Tr>
                {[
                  "Space",
                  "Members",
                  "spaceAdmin.sections.access",
                  "spaceAdmin.features",
                  "spaceAdmin.actions",
                ].map((key) => (
                  <Table.Th key={key}>{t(key)}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((space) => (
                <Table.Tr key={space.id}>
                  <Table.Td {...getResponsivePrimaryCellProps(t("Space"))}>
                    <Group wrap="nowrap">
                      <CustomAvatar
                        name={space.name}
                        avatarUrl={space.logo ?? undefined}
                        type={AvatarIconType.SPACE_ICON}
                        variant="filled"
                      />
                      <div style={{ minWidth: 0 }}>
                        <Anchor
                          component={Link}
                          to={
                            space.canManage
                              ? `/settings/spaces/${encodeURIComponent(space.slug)}/general`
                              : `/s/${space.slug}`
                          }
                          state={{ spacesReturnTo: positionKey }}
                          fw={600}
                          style={{ overflowWrap: "anywhere" }}
                        >
                          {space.name}
                        </Anchor>
                        {space.archivedAt && (
                          <Badge
                            ml="xs"
                            size="xs"
                            color="gray"
                            variant="light"
                            c="var(--mantine-color-text)"
                          >
                            {t("Archived")}
                          </Badge>
                        )}
                        {space.description && (
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {space.description}
                          </Text>
                        )}
                        <Text size="xs" c="dimmed">
                          /s/{space.slug}
                        </Text>
                      </div>
                    </Group>
                  </Table.Td>
                  <Table.Td {...getResponsiveMetaCellProps(t("Members"))}>
                    <Text size="sm">
                      {space.memberCount === undefined
                        ? "—"
                        : t("spaceAdmin.memberCount", {
                            count: space.memberCount,
                          })}
                    </Text>
                  </Table.Td>
                  <Table.Td
                    {...getResponsiveMetaCellProps(
                      t("spaceAdmin.sections.access"),
                    )}
                  >
                    {space.requiresStepUp ? (
                      <Text size="sm">{t("spaceAdmin.confirmSignIn")}</Text>
                    ) : space.access ? (
                      <Stack gap={3}>
                        <Text size="xs">
                          {t(
                            space.access.disablePublicSharing
                              ? "spaceAdmin.sharingDenied"
                              : "spaceAdmin.sharingAllowed",
                          )}
                        </Text>
                        {space.access.enforceMfa && (
                          <Text size="xs">{t("spaceAdmin.mfaRequired")}</Text>
                        )}
                        {space.access.enforceSso && (
                          <Text size="xs">{t("spaceAdmin.ssoRequired")}</Text>
                        )}
                      </Stack>
                    ) : (
                      <Text size="sm">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td
                    {...getResponsiveMetaCellProps(t("spaceAdmin.features"))}
                  >
                    {space.features ? (
                      <Stack gap={3}>
                        <Text size="xs">
                          {t("spaceAdmin.templateState", {
                            value: t(
                              `spaceAdmin.templateStates.${space.features.templates}`,
                            ),
                          })}
                        </Text>
                        <Text size="xs">
                          {t("spaceAdmin.dictionaryState", {
                            value: t(
                              space.features.dictionary
                                ? "Enabled"
                                : "Disabled",
                            ),
                          })}
                        </Text>
                        <Text size="xs">
                          {t(`spaceAdmin.aiStates.${space.features.ai}`)}
                        </Text>
                      </Stack>
                    ) : (
                      <Text size="sm">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td {...getResponsiveActionCellProps()}>
                    <ActionIcon
                      component={Link}
                      size={32}
                      to={`/s/${space.slug}`}
                      aria-label={t("spaceAdmin.openSpace")}
                      variant="subtle"
                    >
                      <IconExternalLink size={18} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </AsyncQueryState>
      {state === "empty" && (query || status !== "active") && (
        <Button
          variant="light"
          onClick={() => {
            setSearch("");
            setParams({});
          }}
        >
          {t("spaceAdmin.clearFilters")}
        </Button>
      )}
      {!!items.length && (
        <Paginate
          hasPrevPage={result.data?.meta.hasPrevPage}
          hasNextPage={result.data?.meta.hasNextPage}
          onNext={() => page(result.data!.meta.nextCursor)}
          onPrev={() => page(result.data!.meta.prevCursor, true)}
        />
      )}
    </Stack>
  );
}
