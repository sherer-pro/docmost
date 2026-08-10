import {
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { apiOrigin, authenticateAdminContext, baseUrl } from "./auth";
import {
  axeDir,
  confirmedDefectsPath,
  consoleDir,
  screenshotsDir,
} from "./paths";

interface ConsoleEvidence {
  type: string;
  text: string;
  url?: string;
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "");
}

function redact(value: string): string {
  return value
    .replace(
      /([?&](?:jwt|token|authToken|csrfToken)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

export const test = base.extend<{ evidence: void }>({
  evidence: [
    async ({ page, context }, use, testInfo) => {
      await authenticateAdminContext(context);
      if (process.env.DOCMOST_API_ORIGIN) {
        const browserOrigin = new URL(baseUrl()).origin;
        const trustedApiOrigin = new URL(apiOrigin()).origin;
        if (browserOrigin !== trustedApiOrigin) {
          await page.route(`${browserOrigin}/api/**`, async (route) => {
            const headers = {
              ...route.request().headers(),
              host: new URL(trustedApiOrigin).host,
              origin: trustedApiOrigin,
              referer: `${trustedApiOrigin}/`,
            };
            const response = await route.fetch({ headers });
            await route.fulfill({ response });
          });
        }
      }
      const drawioAuditUrl = process.env.DOCMOST_DRAWIO_AUDIT_URL?.trim();
      if (drawioAuditUrl) {
        const parsedDrawioUrl = new URL(drawioAuditUrl);
        testInfo.annotations.push({
          type: "harness",
          description:
            "Draw.io uses a local synthetic iframe endpoint; no diagram data is sent to a remote service.",
        });
        await page.route(
          `${parsedDrawioUrl.origin}${parsedDrawioUrl.pathname}**`,
          async (route) => {
            await route.fulfill({
              status: 200,
              contentType: "text/html; charset=utf-8",
              body: "<!doctype html><html><body data-drawio-audit-shim></body></html>",
            });
          },
        );
      }
      if (testInfo.project.name.includes("webkit")) {
        const webkitOrigin = new URL(
          process.env.DOCMOST_WEBKIT_BASE_URL ?? "http://127.0.0.1:3000",
        ).origin;
        if (webkitOrigin.startsWith("http://")) {
          testInfo.annotations.push({
            type: "harness",
            description:
              "The HTTP-only local WebKit harness removes upgrade-insecure-requests; release CSP remains covered by production smoke checks.",
          });
          await page.route(`${webkitOrigin}/**`, async (route) => {
            const response = await route.fetch();
            const headers = response.headers();
            const csp = headers["content-security-policy"];
            if (csp) {
              headers["content-security-policy"] = csp
                .split(";")
                .filter(
                  (directive) =>
                    directive.trim().toLowerCase() !==
                    "upgrade-insecure-requests",
                )
                .join(";");
            }
            await route.fulfill({ response, headers });
          });
        }
      }
      const events: ConsoleEvidence[] = [];
      page.on("console", (message) => {
        if (["warning", "error"].includes(message.type())) {
          events.push({ type: message.type(), text: redact(message.text()) });
        }
      });
      page.on("pageerror", (error) => {
        events.push({ type: "pageerror", text: redact(error.message) });
      });
      page.on("requestfailed", (request) => {
        const url = new URL(request.url());
        events.push({
          type: "requestfailed",
          text: request.failure()?.errorText ?? "request failed",
          url: `${url.origin}${url.pathname}`,
        });
      });
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        await captureStep(page, testInfo, "failure").catch(() => undefined);
      }
      await fs.mkdir(consoleDir, { recursive: true });
      const file = path.join(
        consoleDir,
        `${safeName(testInfo.project.name)}-${safeName(testInfo.title)}.json`,
      );
      await fs.writeFile(file, `${JSON.stringify(events, null, 2)}\n`, "utf8");
    },
    { auto: true },
  ],
});

export async function captureStep(
  page: Page,
  testInfo: TestInfo,
  step: string,
  options: { fullPage?: boolean } = {},
): Promise<string> {
  await fs.mkdir(screenshotsDir, { recursive: true });
  const file = path.join(
    screenshotsDir,
    `${safeName(testInfo.project.name)}-${safeName(step)}.png`,
  );
  await page.screenshot({ path: file, fullPage: options.fullPage ?? false });
  return file;
}

export function mainEditor(page: Page) {
  return page
    .locator('.ProseMirror[role="textbox"][aria-multiline="true"]')
    .first();
}

export function publicDocument(page: Page) {
  return page.locator('main .ProseMirror[contenteditable="false"]').nth(1);
}

export async function runAxe(
  page: Page,
  testInfo: TestInfo,
  scope = ".ProseMirror",
  label = "axe",
): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
  ]);
  if (await page.locator(scope).count()) builder.include(scope);
  const results = await builder.analyze();
  await fs.mkdir(axeDir, { recursive: true });
  const file = path.join(
    axeDir,
    `${safeName(testInfo.project.name)}-${safeName(testInfo.title)}-${safeName(label)}.json`,
  );
  await fs.writeFile(
    file,
    `${JSON.stringify(
      {
        project: testInfo.project.name,
        title: testInfo.title,
        url: page.url().replace(/[?#].*$/, ""),
        violations: results.violations,
        passes: results.passes.length,
        incomplete: results.incomplete.length,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function recordDefect(defect: {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  project: string;
  evidence: string;
}): Promise<void> {
  let defects: Array<typeof defect> = [];
  try {
    defects = JSON.parse(await fs.readFile(confirmedDefectsPath, "utf8"));
  } catch {
    defects = [];
  }
  if (
    !defects.some(
      (item) => item.id === defect.id && item.project === defect.project,
    )
  ) {
    defects.push(defect);
  }
  await fs.writeFile(
    confirmedDefectsPath,
    `${JSON.stringify(defects, null, 2)}\n`,
    "utf8",
  );
}

export { expect };
