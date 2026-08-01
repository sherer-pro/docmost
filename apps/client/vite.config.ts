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
        POSTHOG_HOST,
        POSTHOG_KEY,
      },
      APP_VERSION: JSON.stringify(process.env.npm_package_version),
    },
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 1500,
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
