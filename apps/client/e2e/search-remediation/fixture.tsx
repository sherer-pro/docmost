import "@mantine/core/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/notifications/styles.css";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { Button, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Provider, createStore } from "jotai";
import { I18nextProvider } from "react-i18next";
import i18n, { i18nReady } from "@/i18n";
import { queryClient } from "@/lib/query-client";
import { SearchSpotlight } from "@/features/search/components/search-spotlight";
import { searchSpotlight } from "@/features/search/constants";

const params = new URLSearchParams(location.search);
const store = createStore();
await i18nReady;
await i18n.changeLanguage("en-US");
createRoot(document.getElementById("root")!).render(
  <MantineProvider
    forceColorScheme={params.get("theme") === "dark" ? "dark" : "light"}
  >
    <I18nextProvider i18n={i18n}>
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <HelmetProvider>
            <MemoryRouter>
              <Notifications />
              <Button onClick={() => searchSpotlight.open()}>
                Open search fixture
              </Button>
              <SearchSpotlight spaceId="20000000-0000-4000-8000-000000000001" />
            </MemoryRouter>
          </HelmetProvider>
        </QueryClientProvider>
      </Provider>
    </I18nextProvider>
  </MantineProvider>,
);
