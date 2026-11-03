import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { HelmetProvider } from "react-helmet-async";
import { Button, Group, MantineProvider, Stack } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { createStore, Provider, useSetAtom } from "jotai";
import { I18nextProvider } from "react-i18next";
import i18n, { i18nReady } from "@/i18n";
import PageHeaderMenu from "@/features/page/components/header/page-header-menu";
import DatabaseHeaderMenu from "@/features/database/components/header/database-header-menu";
import HistoryModal from "@/features/page-history/components/history-modal";
import { historyAtoms } from "@/features/page-history/atoms/history-atoms";
import AccountLanguage from "@/features/user/components/account-language";
import AccountTheme from "@/features/user/components/account-theme";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { queryClient } from "@/lib/query-client";
import {
  PAGE_QUERY_KEYS,
  DATABASE_QUERY_KEYS,
} from "@/features/page/queries/query-keys";
import { PAGE_DETAILS_QUERY_KEYS } from "@/features/page/queries/page-details-query";

const params = new URLSearchParams(location.search);
const locale = params.get("locale") ?? "en-US";
const kind = params.get("kind") ?? "page";
const reader = params.has("reader");
await i18nReady;
await i18n.changeLanguage(locale);
const store = createStore();
const space = {
  id: "20000000-0000-4000-8000-000000000001",
  slug: "synthetic",
  name: "Synthetic space",
  membership: {
    role: reader ? "reader" : "admin",
    permissions: [{ action: reader ? "read" : "manage", subject: "page" }],
  },
  settings: { sharing: { disabled: true } },
};
store.set(currentUserAtom, {
  user: {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Synthetic user",
    role: reader ? "member" : "owner",
    locale,
    settings: { preferences: {} },
  },
  workspace: { id: "40000000-0000-4000-8000-000000000001" },
} as any);
queryClient.setDefaultOptions({
  queries: { staleTime: Infinity, retry: false },
});
queryClient.setQueryData(["space", space.id], space);
queryClient.setQueryData(["space", space.slug], space);
for (const index of [1, 2]) {
  const id = `10000000-0000-4000-8000-00000000000${index}`;
  const slugId = `synthetic0${index}`;
  const databaseId = `50000000-0000-4000-8000-00000000000${index}`;
  const page = {
    id,
    slugId,
    spaceId: space.id,
    space,
    title: `Synthetic page ${index}`,
    parentPageId: null,
    creator: { name: "Synthetic creator" },
    lastUpdatedBy: { name: "Synthetic editor" },
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Synthetic page content" }],
        },
      ],
    },
    access: {
      capabilities: {
        canWrite: !reader,
        canMoveDeleteShare: false,
        canManageAccess: false,
      },
    },
    ...(kind === "database" ? { databaseId } : {}),
  };
  queryClient.setQueryData(PAGE_QUERY_KEYS.page(id), page);
  queryClient.setQueryData(PAGE_QUERY_KEYS.page(slugId), page);
  queryClient.setQueryData(PAGE_DETAILS_QUERY_KEYS.labels(id), { items: [] });
  queryClient.setQueryData(PAGE_DETAILS_QUERY_KEYS.backlinksCount(id), {
    incoming: 123456,
    outgoing: 987654,
  });
  queryClient.setQueryData(PAGE_DETAILS_QUERY_KEYS.templateProvenance(id), {
    createdFromTemplate: false,
  });
  queryClient.setQueryData(["page-templates", "capabilities", space.id], {
    enabled: false,
  });
  queryClient.setQueryData(["ai", "status", space.id, id], { enabled: false });
  queryClient.setQueryData(DATABASE_QUERY_KEYS.byId(databaseId), {
    id: databaseId,
    pageId: id,
    pageSlugId: slugId,
    spaceId: space.id,
    name: page.title,
  });
  queryClient.setQueryData(DATABASE_QUERY_KEYS.properties(databaseId), []);
}

// eslint-disable-next-line react-refresh/only-export-components
function Panels() {
  const [headerMounted, setHeaderMounted] = useState(true);
  const navigate = useNavigate();
  const { pageSlug, databaseSlug } = useParams();
  const index = (pageSlug ?? databaseSlug)?.endsWith("02") ? 2 : 1;
  const pageId = `10000000-0000-4000-8000-00000000000${index}`;
  const setHistoryOpen = useSetAtom(historyAtoms);
  const nextPath = `/s/synthetic/${kind === "database" ? "db" : "p"}/page-synthetic0${index === 1 ? 2 : 1}`;
  return (
    <main style={{ padding: 12, minWidth: 0 }}>
      {kind === "preferences" ? (
        <Stack>
          <AccountLanguage />
          <AccountTheme />
        </Stack>
      ) : (
        <>
          {headerMounted && (
            <Group gap={4} wrap="nowrap" data-header-fixture>
              {kind === "database" ? (
                <DatabaseHeaderMenu
                  databaseId={`50000000-0000-4000-8000-00000000000${index}`}
                  databasePageId={pageId}
                  spaceSlug="synthetic"
                  readOnly={reader}
                />
              ) : (
                <PageHeaderMenu readOnly={reader} />
              )}
            </Group>
          )}
          <Button
            mt="md"
            data-toggle-header
            onClick={() => setHeaderMounted((mounted) => !mounted)}
          >
            Toggle header fixture
          </Button>
          <Button mt="md" data-change-page onClick={() => navigate(nextPath)}>
            Change page
          </Button>
          <Button
            mt="md"
            data-open-history
            onClick={() => setHistoryOpen(true)}
          >
            Open history fixture
          </Button>
          <HistoryModal pageId={pageId} readOnly={reader} />
          <input aria-label="Outside dialog" />
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <MantineProvider
    forceColorScheme={params.get("theme") === "dark" ? "dark" : "light"}
  >
    <I18nextProvider i18n={i18n}>
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <HelmetProvider>
            <ModalsProvider>
              <Notifications />
              <MemoryRouter
                initialEntries={[
                  `/s/synthetic/${kind === "database" ? "db" : "p"}/page-synthetic01`,
                ]}
              >
                <Routes>
                  <Route
                    path="/s/:spaceSlug/p/:pageSlug"
                    element={<Panels />}
                  />
                  <Route
                    path="/s/:spaceSlug/db/:databaseSlug"
                    element={<Panels />}
                  />
                </Routes>
              </MemoryRouter>
            </ModalsProvider>
          </HelmetProvider>
        </QueryClientProvider>
      </Provider>
    </I18nextProvider>
  </MantineProvider>,
);
