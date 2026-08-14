import "@mantine/core/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";
import "@/features/dictionary/styles/dictionary-highlight.css";
import "@/styles/accessibility.css";

import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { mantineCssResolver, theme } from "@/theme";
import { Center, Loader, MantineProvider } from "@mantine/core";
import { BrowserRouter } from "react-router-dom";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { i18nReady } from "./i18n";
import { registerServiceWorker } from "@/lib/pwa/register-service-worker.ts";
import { registerStaleClientRecovery } from "@/lib/pwa/stale-client-recovery.ts";
import APP_ROUTE from "@/lib/app-route.ts";
import {
  clearSensitiveClientState,
  registerLogoutSync,
} from "@/features/auth/utils/client-session-cleanup.ts";
import { queryClient } from "@/lib/query-client.ts";

registerStaleClientRecovery();

registerLogoutSync(async () => {
  queryClient.clear();
  await clearSensitiveClientState();
  window.location.replace(APP_ROUTE.AUTH.LOGIN);
});

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <MantineProvider theme={theme} cssVariablesResolver={mantineCssResolver}>
    <Center h="100dvh" role="status" aria-live="polite">
      <Loader size="sm" />
    </Center>
  </MantineProvider>,
);

void i18nReady
  .catch(() => undefined)
  .then(() =>
    root.render(
      <BrowserRouter>
        <MantineProvider
          theme={theme}
          cssVariablesResolver={mantineCssResolver}
        >
          <ModalsProvider>
            <QueryClientProvider client={queryClient}>
              <Notifications
                position="bottom-center"
                limit={3}
                zIndex={10000}
              />
              <HelmetProvider>
                <App />
              </HelmetProvider>
            </QueryClientProvider>
          </ModalsProvider>
        </MantineProvider>
      </BrowserRouter>,
    ),
  );

// Register the PWA worker outside the React tree so offline caching logic
// is not coupled to the lifecycle of React components.
registerServiceWorker();
