import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

export const auditRoot = path.resolve(
  process.cwd(),
  "../../output/audit/ai-assistant-2026-08-07",
);
export const statePath = path.join(auditRoot, "audit-state.json");
const runtimeAuthToken = process.env.DOCMOST_AUTH_TOKEN?.trim();
const runtimeCsrfToken = process.env.DOCMOST_CSRF_TOKEN?.trim();

interface AuditState {
  runId: string;
  spaceId: string;
  spaceSlug: string;
  pageId: string;
  pageSlugId: string;
  pageTitle: string;
}

function redact(value: string): string {
  return value
    .replace(/([?&](?:jwt|token|authToken|csrfToken)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/audit-canary-[A-Za-z0-9_-]+/gi, "[redacted-canary]");
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "");
}

export async function loadState(): Promise<AuditState> {
  return JSON.parse(await fs.readFile(statePath, "utf8")) as AuditState;
}

export function pageUrl(state: AuditState): string {
  const slug = state.pageTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `/s/${state.spaceSlug}/p/${slug}-${state.pageSlugId}`;
}

export function messageComposer(page: Page) {
  return page.locator(
    '[role="textbox"][aria-label="Ask about this document…"], [role="textbox"][aria-label="Спросите об этом документе…"]',
  );
}

export async function openAssistant(page: Page, state: AuditState): Promise<void> {
  await page.goto(pageUrl(state));
  const composer = messageComposer(page);
  const openButton = page.getByRole("button", { name: /Open AI assistant|Открыть AI-помощника/i });
  const aside = page.locator("#docmost-context-aside");

  if (await composer.isVisible()) return;
  const restoredPanel = await composer
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (restoredPanel) return;

  await expect(openButton).toBeAttached();
  if ((await aside.count()) === 0 || (await aside.getAttribute("aria-hidden")) === "true") {
    await openButton.click({ force: true });
  }
  await expect(composer).toBeVisible();
}

export const test = base.extend<{ evidence: void }>({
  evidence: [
    async ({ page, context }, use, testInfo) => {
      const authToken = runtimeAuthToken;
      const csrfToken = runtimeCsrfToken;
      if (!authToken || !csrfToken) throw new Error("DOCMOST_AUTH_TOKEN and DOCMOST_CSRF_TOKEN are required at runtime");
      const url = new URL(process.env.DOCMOST_BASE_URL ?? "http://localhost:3000");
      await context.addCookies([
        { name: "authToken", value: authToken, domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax", secure: url.protocol === "https:" },
        { name: "csrfToken", value: csrfToken, domain: url.hostname, path: "/", httpOnly: false, sameSite: "Lax", secure: url.protocol === "https:" },
      ]);
      await fs.mkdir(path.join(auditRoot, "traces"), { recursive: true });
      const tracePath = path.join(
        auditRoot,
        "traces",
        `${safeName(testInfo.project.name)}-${safeName(testInfo.title)}.zip`,
      );
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const network: Array<Record<string, unknown>> = [];
      const consoleEvents: Array<Record<string, string>> = [];
      page.on("response", (response) => {
        const requestUrl = new URL(response.url());
        if (requestUrl.origin === url.origin && (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.startsWith("/socket.io/"))) network.push({ method: response.request().method(), path: requestUrl.pathname, status: response.status() });
      });
      page.on("requestfailed", (request) => {
        const requestUrl = new URL(request.url());
        network.push({ method: request.method(), path: requestUrl.pathname, failure: redact(request.failure()?.errorText ?? "request failed") });
      });
      page.on("console", (message) => {
        if (["warning", "error"].includes(message.type())) consoleEvents.push({ type: message.type(), text: redact(message.text()) });
      });
      page.on("pageerror", (error) => consoleEvents.push({ type: "pageerror", text: redact(error.message) }));
      await use();
      const prefix = `${safeName(testInfo.project.name)}-${safeName(testInfo.title)}`;
      await fs.mkdir(path.join(auditRoot, "network"), { recursive: true });
      await fs.mkdir(path.join(auditRoot, "console-errors"), { recursive: true });
      await fs.writeFile(path.join(auditRoot, "network", `${prefix}.json`), `${JSON.stringify(network, null, 2)}\n`);
      await fs.writeFile(path.join(auditRoot, "console-errors", `${prefix}.json`), `${JSON.stringify(consoleEvents, null, 2)}\n`);
      if (testInfo.status !== testInfo.expectedStatus) {
        await fs.mkdir(path.join(auditRoot, "screenshots"), { recursive: true });
        await page.screenshot({ path: path.join(auditRoot, "screenshots", `${prefix}.png`), fullPage: true }).catch(() => undefined);
      }
      await context.tracing.stop({ path: tracePath });
    },
    { auto: true },
  ],
});

export { expect };
