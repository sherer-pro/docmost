import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const auditRoot = path.resolve(
  process.env.DOCMOST_EDITOR_AUDIT_ROOT ??
    path.join(
      process.cwd(),
      "../../output/audit/page-templates-transclusion-2026-08-09",
    ),
);
const defaultBaseURL = process.env.DOCMOST_BASE_URL ?? "http://localhost:3000";
const webkitBaseURL =
  process.env.DOCMOST_WEBKIT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e/editor/specs",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  outputDir: path.join(auditRoot, "playwright-artifacts"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(auditRoot, "playwright-results.json") }],
    [
      "html",
      { outputFolder: path.join(auditRoot, "playwright-html"), open: "never" },
    ],
  ],
  use: {
    baseURL: defaultBaseURL,
    locale: "en-US",
    timezoneId: "Europe/Moscow",
    colorScheme: "light",
    trace: "retain-on-failure",
    video:
      process.env.DOCMOST_EDITOR_AUDIT_VIDEO === "1"
        ? "on"
        : "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "chromium-desktop",
      testIgnore: /mobile-accessibility\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-desktop",
      testIgnore: /mobile-accessibility\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-media-clipboard",
      testMatch: /media-clipboard\.spec\.ts/,
      use: { ...devices["Desktop Safari"], baseURL: webkitBaseURL },
    },
    {
      name: "mobile-chromium",
      testMatch: /(mobile-accessibility|templates-transclusion)\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-webkit",
      testMatch: /(mobile-accessibility|templates-transclusion)\.spec\.ts/,
      use: { ...devices["iPhone 15"], baseURL: webkitBaseURL },
    },
  ],
});
