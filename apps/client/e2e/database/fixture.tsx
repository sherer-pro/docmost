import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { createRoot } from "react-dom/client";
import { MantineProvider, Button, Group } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { ModalsProvider } from "@mantine/modals";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { createStore, Provider } from "jotai";
import { useState } from "react";
import i18n, { i18nReady } from "@/i18n";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { queryClient } from "@/lib/query-client";
import { DatabaseTableView } from "@/features/database/components/database-table-view";

const params = new URLSearchParams(location.search);
const store = createStore();
const databaseId = "10000000-0000-4000-8000-000000000001";
const spaceId = "20000000-0000-4000-8000-000000000001";
store.set(currentUserAtom, {
  user: {
    id: "30000000-0000-4000-8000-000000000001",
    settings: { preferences: {} },
  },
  workspace: { id: "40000000-0000-4000-8000-000000000001" },
} as any);
// eslint-disable-next-line react-refresh/only-export-components
function Fixture() {
  const [mounted, setMounted] = useState(true);
  return (
    <MantineProvider
      forceColorScheme={params.get("theme") === "dark" ? "dark" : "light"}
    >
      <Notifications />
      <ModalsProvider>
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <main style={{ padding: 12, minWidth: 0 }}>
                <Group mb="sm">
                  <Button onClick={() => setMounted((value) => !value)}>
                    Toggle database
                  </Button>
                </Group>
                {mounted && (
                  <DatabaseTableView
                    key={databaseId}
                    databaseId={databaseId}
                    spaceId={spaceId}
                    spaceSlug="synthetic"
                    isEditable={params.get("role") !== "reader"}
                  />
                )}
              </main>
            </BrowserRouter>
          </QueryClientProvider>
        </Provider>
      </ModalsProvider>
    </MantineProvider>
  );
}
await i18nReady;
await i18n.changeLanguage(params.get("locale") ?? "en-US");
createRoot(document.getElementById("root")!).render(<Fixture />);
