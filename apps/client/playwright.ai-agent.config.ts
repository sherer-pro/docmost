import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const runId = process.env.DOCMOST_AI_AGENT_RUN_ID ?? "unconfigured";
const auditRoot = path.resolve(
  process.env.DOCMOST_AI_AGENT_AUDIT_ROOT ??
    path.join(process.cwd(), "../../output/audit/ai-agent-mode-2026-08-09", runId),
);

export default defineConfig({
  testDir: "./e2e/ai-agent/specs",
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  outputDir: path.join(auditRoot, "playwright-artifacts"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(auditRoot, "playwright-results.json") }],
    ["html", { outputFolder: path.join(auditRoot, "playwright-html"), open: "never" }],
  ],
  use: {
    baseURL: process.env.DOCMOST_BASE_URL ?? "http://localhost:3000",
    timezoneId: "Europe/Moscow",
    locale: "en-US",
    colorScheme: "light",
    trace: "off",
    video: "on",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "chromium-agent-audit",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
