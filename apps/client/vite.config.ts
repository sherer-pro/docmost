import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "path";

export const envPath = path.resolve(process.cwd(), "..", "..");

export default defineConfig(({ mode }) => {
  const {
    APP_URL,
    FILE_UPLOAD_SIZE_LIMIT,
    FILE_IMPORT_SIZE_LIMIT,
    EMBED_ALLOWED_ORIGINS,
    DRAWIO_URL,
    CLOUD,
    SUBDOMAIN_HOST,
    COLLAB_URL,
    BILLING_TRIAL_DAYS,
    POSTHOG_HOST,
    POSTHOG_KEY,
  } = loadEnv(mode, envPath, "");

  return {
    define: {
      "process.env": {
        APP_URL,
        FILE_UPLOAD_SIZE_LIMIT,
        FILE_IMPORT_SIZE_LIMIT,
        EMBED_ALLOWED_ORIGINS,
        DRAWIO_URL,
        CLOUD,
        SUBDOMAIN_HOST,
        COLLAB_URL,
        BILLING_TRIAL_DAYS,
        POSTHOG_HOST,
        POSTHOG_KEY,
      },
      APP_VERSION: JSON.stringify(process.env.npm_package_version),
    },
    plugins: [react()],
    build: {
      // Keep diagram runtimes together: Mermaid and Excalidraw import shared
      // helpers, and splitting them creates circular manual chunks.
      chunkSizeWarningLimit: 5000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return;
            }

            if (id.includes("excalidraw") || id.includes("mermaid")) {
              return "vendor-diagrams";
            }

            // Leave the rest of node_modules to Rollup so it can avoid
            // cross-chunk initialization cycles between React/editor deps.
            return;
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": "/src",
        "@docmost/api-contract": path.resolve(
          envPath,
          "packages/api-contract/src/index.ts",
        ),
        "@docmost/editor-ext": path.resolve(
          envPath,
          "packages/editor-ext/src/index.ts",
        ),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: APP_URL,
          changeOrigin: false,
        },
        "/socket.io": {
          target: APP_URL,
          ws: true,
          rewriteWsOrigin: true,
        },
        "/collab": {
          target: APP_URL,
          ws: true,
          rewriteWsOrigin: true,
        },
      },
    },
  };
});
