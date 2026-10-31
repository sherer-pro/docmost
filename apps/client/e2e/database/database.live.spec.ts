import {
  expect,
  test as base,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { editorClipboard } from "./editor-clipboard";

const test = base.extend({
  serviceWorkers: async ({ browserName: _browserName }, provide, info) => {
    // Network interception cannot see requests controlled by a Service Worker.
    const injectsNetworkFault =
      /^live (network failure|delayed response|TSV|empty database)/.test(
        info.title,
      );
    await provide(injectsNetworkFault ? "block" : "allow");
  },
});

async function editViewName(page: Page, name: string) {
  await page.getByRole("button", { name: /^View settings \(/ }).click();
  const settings = page.getByRole("dialog", {
    name: "View settings",
    exact: true,
  });
  await settings.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
}

for (const [index, theme, width] of [[0, 'light', 1440], [1, 'dark', 390]] as const)
  test(`live MCP OAuth consent and connected applications ${theme} ${width}`, async ({ page }, info) => {
    await page.addInitScript((value) => localStorage.setItem('mantine-color-scheme-value', value), theme);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixture.mcpOAuth.consentRoutes[index]);
    await expect(page.getByRole('heading', { name: 'Authorize MCP application', exact: true })).toBeVisible();
    await expect(page.getByText(fixture.mcpOAuth.clientName, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow read access', exact: true })).toBeDisabled();
    await page.getByRole('textbox', { name: 'Select a space', exact: true }).click();
    await page.getByRole('option', { name: 'Database acceptance', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Allow read access', exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`mcp-oauth-consent-${theme}-${width}.png`) });
    let callbackReached = false;
    await page.route(`${fixture.mcpOAuth.callback}**`, async (route) => {
      callbackReached = true;
      const returnTo = new URL('/settings/account/connections', process.env.DATABASE_LIVE_URL).href;
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<script>history.replaceState(null,"","/callback");location.replace(${JSON.stringify(returnTo)})</script>` });
    });
    await page.getByRole('button', { name: 'Allow read access', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/account\/connections$/);
    expect(callbackReached).toBe(true);
    await expect(page.getByRole('heading', { name: 'Connected applications', exact: true })).toBeVisible();
    const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true }).first();
    await expect(disconnect).toBeVisible();
    await disconnect.click();
    await expect(disconnect).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Connected applications', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`mcp-oauth-connections-${theme}-${width}.png`) });
  });

for (const [theme, width] of [
  ["light", 1440],
  ["dark", 390],
] as const)
  test(`live DOCX page export downloads native document ${theme} ${width}`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem("mantine-color-scheme-value", value),
      theme,
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixture.docx.route);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Export", exact: true }).click();
    const modal = page.getByRole("dialog", {
      name: "Export page",
      exact: true,
    });
    await modal
      .getByRole("textbox", { name: "Select export format", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Word (DOCX)", exact: true })
      .click();
    const downloading = page.waitForEvent("download");
    await modal.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const target = info.outputPath("page-docx.zip");
    await download.saveAs(target);
    const { readFile } = await import("node:fs/promises");
    const { createRequire } = await import("node:module");
    const { resolve } = await import("node:path");
    const require = createRequire(
      resolve(process.cwd(), "../server/package.json"),
    );
    const JSZip = require("jszip");
    const archive = await JSZip.loadAsync(await readFile(target));
    const document = Object.values(archive.files).find((entry: any) =>
      entry.name.endsWith(".docx"),
    ) as any;
    expect(document).toBeTruthy();
    const bytes = await document.async("nodebuffer");
    const content = await JSZip.loadAsync(bytes);
    expect(await content.file("word/document.xml").async("string")).toContain(
      "DOCX_BODY_EVIDENCE",
    );
    expect(
      Object.keys(content.files).some((name) =>
        /word\/media\/.*\.png$/.test(name),
      ),
    ).toBe(true);
    await expect(modal).toBeHidden();
    await page.screenshot({
      path: info.outputPath(`docx-export-${theme}-${width}.png`),
    });
  });
async function expectViewName(page: Page, name: string) {
  await page.getByRole("button", { name: /^View settings \(/ }).click();
  const settings = page.getByRole("dialog", {
    name: "View settings",
    exact: true,
  });
  await expect(
    settings.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue(name);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
}

const fixture = JSON.parse(process.env.DATABASE_LIVE_FIXTURE!);
const sessions = JSON.parse(process.env.DATABASE_LIVE_SESSIONS!);

for (const [theme, width] of [['light', 1440], ['dark', 390]] as const)
  test(`live integration previews isolate viewer credentials ${theme} ${width}`, async ({ page, browser }, info) => {
    const admin = await browser.newContext({ storageState: sessions.admin, baseURL: process.env.DATABASE_LIVE_URL });
    const reader = await browser.newContext({ storageState: sessions.reader, baseURL: process.env.DATABASE_LIVE_URL });
    try {
      await api(admin.request, '/integration-previews/settings', 'PATCH', { enabled: true });
      await api(page.request, '/integration-previews/connections/github', 'PUT', { credential: 'synthetic-preview-browser' });
      await page.addInitScript((value) => localStorage.setItem('mantine-color-scheme-value', value), theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(fixture.integrationPreviews.route);
      const card = page.locator('[data-type="integrationPreview"]');
      await expect(card.getByRole('link', { name: 'Private github metadata', exact: true })).toBeVisible();
      const other = await reader.newPage();
      await other.goto(fixture.integrationPreviews.route);
      await expect(other.locator('[data-type="integrationPreview"]')).toContainText('Public GitHub metadata');
      await expect(other.locator('[data-type="integrationPreview"]')).not.toContainText('Private github metadata');
      await page.reload();
      await expect(card).toContainText('Private github metadata');
      const saved = await api(page.request, `/pages/info?pageId=${fixture.integrationPreviews.pageId}`);
      expect(JSON.stringify(saved.content)).not.toContain('Private github metadata');
      await page.screenshot({ path: info.outputPath(`integration-preview-${theme}-${width}.png`) });
      await page.goto('/settings/account/connections?tab=previews');
      await expect(page.getByRole('heading', { name: 'Connected applications', exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'MCP', exact: true })).toBeVisible();
      await expect(page.getByText('Configured', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await expect(page.getByText('Configured', { exact: true })).toHaveCount(0);
      await page.goto(fixture.integrationPreviews.route);
      await expect(card).toContainText('Public GitHub metadata');
    } finally {
      await api(page.request, '/integration-previews/connections/github', 'DELETE');
      await api(admin.request, '/integration-previews/settings', 'PATCH', { enabled: false });
      await reader.close();
      await admin.close();
    }
  });

const browserErrors = new WeakMap<Page, string[]>();
const browserErrorTasks = new WeakMap<Page, Promise<unknown>[]>();
test.beforeEach(async ({ page }) => {
  // The shared synthetic user can retain an AI drawer opened by an earlier case.
  await api(page.request, "/users/update", "POST", { aiPanelOpen: false });
  const errors: string[] = [];
  const tasks: Promise<unknown>[] = [];
  browserErrors.set(page, errors);
  browserErrorTasks.set(page, tasks);
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() !== "error" || errors.length >= 100) return;
    errors.push(message.text().slice(0, 4000));
    tasks.push(
      Promise.allSettled(
        message.args().map((handle) =>
          handle.evaluate((value) => {
            if (!value || typeof value !== "object") return null;
            return {
              message:
                typeof value.message === "string"
                  ? value.message.slice(0, 500)
                  : undefined,
              stack:
                typeof value.stack === "string"
                  ? value.stack.slice(0, 1400)
                  : undefined,
              componentStack:
                typeof value.componentStack === "string"
                  ? value.componentStack.slice(0, 3000)
                  : undefined,
            };
          }),
        ),
      ).then((results) => {
        for (const result of results)
          if (result.status === "fulfilled" && result.value)
            errors.push(JSON.stringify(result.value));
      }),
    );
  });
});
test.afterEach(async ({ page, request }, info) => {
  const errors = browserErrors.get(page) ?? [];
  if (info.status !== info.expectedStatus) {
    if (!page.isClosed())
      await info.attach("navigation", {
        body: Buffer.from(page.url()),
        contentType: "text/plain",
      });
    if (!page.isClosed())
      await info.attach("page-readiness", {
        body: Buffer.from(
          JSON.stringify(
            await page.evaluate(() => ({
              loadingIndicators: document.querySelectorAll(
                '[aria-label="Loading..."]',
              ).length,
              dialogs: Array.from(
                document.querySelectorAll('[role="dialog"]'),
                (element) => ({
                  title: element.querySelector("h2")?.textContent,
                  labelledBy: element.getAttribute("aria-labelledby"),
                  labelledText: element
                    .getAttribute("aria-labelledby")
                    ?.split(/\s+/)
                    .map((id) => document.getElementById(id)?.textContent),
                  display: getComputedStyle(element).display,
                  visibility: getComputedStyle(element).visibility,
                  hidden: element.getAttribute("aria-hidden"),
                  ancestors: (() => {
                    const result = [];
                    let parent = element.parentElement;
                    while (parent && result.length < 5) {
                      result.push({
                        tag: parent.tagName,
                        hidden: parent.getAttribute("aria-hidden"),
                        inert: parent.hasAttribute("inert"),
                        display: getComputedStyle(parent).display,
                        visibility: getComputedStyle(parent).visibility,
                      });
                      parent = parent.parentElement;
                    }
                    return result;
                  })(),
                }),
              ),
              assets: performance
                .getEntriesByType("resource")
                .filter((entry) => /\/assets\/.*\.js$/.test(entry.name))
                .slice(-25)
                .map((entry) => ({
                  path: new URL(entry.name).pathname,
                  start: entry.startTime,
                  duration: entry.duration,
                })),
              api: performance
                .getEntriesByType("resource")
                .filter((entry) =>
                  new URL(entry.name).pathname.startsWith("/api/"),
                )
                .slice(-30)
                .map((entry) => ({
                  path: new URL(entry.name).pathname,
                  start: entry.startTime,
                  duration: entry.duration,
                })),
              navigation: performance
                .getEntriesByType("navigation")
                .map((entry) => ({
                  start: entry.startTime,
                  duration: entry.duration,
                })),
            })),
          ),
        ),
        contentType: "application/json",
      });
    await Promise.race([
      Promise.allSettled(browserErrorTasks.get(page) ?? []),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (errors.length)
      await info.attach("browser-errors", {
        body: Buffer.from(errors.join("\n\n")),
        contentType: "text/plain",
      });
  }
  if (info.title.startsWith("live record editor")) {
    if (!page.isClosed()) await page.close();
    await api(request, "/pages/actions/update", "POST", {
      pageId: fixture.ids[103],
      title: "Row 0103",
    });
  }
});
const notesId = fixture.properties[0].id;
const cell = (page: Page, index: number, property = 0) =>
  page.locator(
    `[data-database-cell-key="${fixture.ids[index]}:${fixture.properties[property].id}"]`,
  );
async function api(
  request: APIRequestContext,
  endpoint: string,
  method = "GET",
  data?: unknown,
) {
  const csrf = (await request.storageState()).cookies.find(
    (cookie) => cookie.name === "csrfToken",
  )?.value;
  const response = await request.fetch(`/api${endpoint}`, {
    method,
    data,
    headers: {
      Origin: process.env.DATABASE_LIVE_URL!,
      Referer: `${process.env.DATABASE_LIVE_URL}/`,
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
  });
  expect(
    response.ok(),
    `${method} ${endpoint.split("?")[0]}: ${response.status()}`,
  ).toBe(true);
  if (response.status() === 204) return;
  const value = await response.json();
  return value.data ?? value;
}
async function row(page: Page, index: number) {
  const result = await api(
    page.request,
    `/databases/${fixture.databaseId}/rows?limit=100`,
  );
  return result.items.find((item: any) => item.pageId === fixture.ids[index]);
}
async function open(page: Page) {
  const initialPage = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/pages/info" && response.ok(),
  );
  await page.goto(fixture.route);
  await initialPage;
  await expect(page.getByText("Rows: 900", { exact: true })).toBeVisible();
  await expect(cell(page, 101)).toBeVisible();
}
const gridViewport = (page: Page) =>
  page
    .locator(".mantine-ScrollArea-viewport")
    .filter({ has: page.locator("[data-database-cell-key]") });
async function selectShared(page: Page) {
  await page.getByRole("textbox", { name: "View", exact: true }).click();
  await page.getByRole("option", { name: "Shared view", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "View", exact: true }),
  ).toHaveValue("Shared view");
}

test("live AI cell preview, explicit approval and durable row receipt", async ({
  page,
}, info) => {
  await open(page);
  await api(
    page.request,
    `/ai/conversations/${fixture.aiApproval.conversationId}/actions/open`,
    "POST",
    {},
  );
  await page.getByRole("button", { name: /Open AI assistant/i }).click();
  const aside = page.locator("#docmost-context-aside");
  const preview = aside.getByRole("group", {
    name: "Proposed page change",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("row")).toHaveCount(3);
  await expect(preview.getByText("Alpha", { exact: true })).toHaveCount(2);
  await expect(preview.getByText("Beta", { exact: true })).toHaveCount(2);
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("ai-database-preview.png") });
  await aside.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    aside.getByText("Applied rows: 2", { exact: true }),
  ).toBeVisible();
  const run = await api(page.request, `/ai/runs/${fixture.aiApproval.runId}`);
  expect(
    run.steps.find((step: any) => step.id === fixture.aiApproval.stepId).result
      .updatedRows,
  ).toEqual(fixture.ids.slice(154, 156));
  await aside.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(aside).toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(
      async () =>
        (await api(page.request, "/users/me")).user?.settings?.preferences
          ?.aiPanelOpen,
    )
    .toBe(false);
});

for (const [width, theme] of [
  [1440, "light"],
  [390, "dark"],
] as const) {
  test(`live AI database results keep the frozen selection and private access ${theme} ${width}`, async ({
    page,
    browser,
  }, info) => {
    const results = fixture.aiApproval.results;
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (scheme) => localStorage.setItem("mantine-color-scheme-value", scheme),
      theme,
    );
    if (width === 1440) {
      await open(page);
      await api(
        page.request,
        `/ai/conversations/${results.conversationId}/actions/open`,
        "POST",
        {},
      );
      await page.getByRole("button", { name: /Open AI assistant/i }).click();
      const card = page.locator(
        `[data-ai-database-result="${results.stepId}"]`,
      );
      await expect(
        card.getByText("Records included: 3", { exact: true }),
      ).toBeVisible();
      await card
        .getByRole("link", { name: "View matching records", exact: true })
        .click();
    } else {
      await page.goto(results.resultUrl);
    }
    await expect(page).toHaveURL(new RegExp(results.resultUrl));
    const resultPage = page.getByTestId("ai-database-results-page");
    await expect(
      resultPage.getByRole("heading", {
        name: "AI database results",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      resultPage.getByText("Selected records: 3", { exact: true }),
    ).toBeVisible();
    await expect(
      resultPage.getByText(results.displayTotal, { exact: true }),
    ).toBeVisible();
    await expect(resultPage.locator("tbody tr")).toHaveCount(3);
    for (const id of results.selectedPageIds)
      await expect(
        resultPage.locator(`[data-ai-database-result-row="${id}"]`),
      ).toBeAttached();
    await expect(resultPage.getByRole("textbox")).toHaveCount(0);
    await expect(
      resultPage.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await resultPage.getByText("Selection conditions", { exact: true }).click();
    await expect(resultPage.getByText(/Sort:.*Descending/)).toBeVisible();
    await expect(
      resultPage.getByText(
        `Columns: Title, ${fixture.properties[1].name}, ${fixture.properties[0].name}`,
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`ai-database-results-${theme}-${width}.png`),
      fullPage: true,
    });
    await page.reload();
    await expect(resultPage.locator("tbody tr")).toHaveCount(3);
    const context = await browser.newContext({
      storageState: sessions.reader,
      viewport: { width, height: 1000 },
    });
    try {
      const other = await context.newPage();
      await other.goto(results.resultUrl);
      const denied = other.getByTestId("ai-database-results-page");
      await expect(
        denied.getByText("Database results are unavailable.", { exact: true }),
      ).toBeVisible();
      await expect(denied.locator("tbody tr")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test("live result links highlight matches and navigate without enabling page writes", async ({
  page,
}) => {
  await page.goto(
    `${fixture.searchPage.route}?find=${encodeURIComponent(fixture.searchPage.query)}`,
  );
  await expect(page.getByPlaceholder("Find", { exact: true })).toHaveValue(
    fixture.searchPage.query,
  );
  await expect(page.locator(".tiptap .search-result")).toHaveCount(2);
  await expect(page.locator(".tiptap .search-result-current")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Next match (Enter)", exact: true })
    .click();
  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
});

test("live subpage order is saved without changing the page tree order", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto(fixture.searchPage.route);
  const block = page.getByRole("navigation", { name: "Subpages", exact: true });
  await expect(block.getByRole("link")).toHaveText([
    "Alpha child",
    "Zulu child",
  ]);
  await page
    .getByTestId("page-state-segmented-control")
    .locator("label")
    .filter({ hasText: /^Edit$/ })
    .click();
  await block.getByRole("textbox", { name: "Subpage order" }).click();
  await page.getByRole("option", { name: "Manual order", exact: true }).click();
  await expect(block.getByRole("link")).toHaveText([
    "Zulu child",
    "Alpha child",
  ]);
  await expect
    .poll(
      async () => {
        const pageData = await api(
          page.request,
          `/pages/info?pageId=${fixture.searchPage.id}`,
        );
        return pageData.content.content.find(
          (node: any) => node.type === "subpages",
        )?.attrs.sort;
      },
      { timeout: 55000 },
    )
    .toBe("manual");
  await page.reload();
  await expect(
    page
      .getByRole("navigation", { name: "Subpages", exact: true })
      .getByRole("link"),
  ).toHaveText(["Zulu child", "Alpha child"]);
});

for (const theme of ["light", "dark"])
  for (const width of [1440, 390])
    test(`live attachment gallery keeps its context ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.addInitScript(
        (value) => localStorage.setItem("mantine-color-scheme-value", value),
        theme,
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(fixture.gallery.route);
      if (width < 600) {
        await page
          .getByRole("button", { name: "Open menu", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "Page details", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", { name: "Page details", exact: true })
          .click();
      }
      const details = page.getByRole("dialog", {
        name: "Page details",
        exact: true,
      });
      await details
        .getByRole("tab", { name: "Attachments", exact: true })
        .click();
      await expect(
        details.getByRole("button", { name: "01-gallery.png", exact: true }),
      ).toBeVisible();
      await expect(
        details.getByText("private-filename-must-not-leak.txt", {
          exact: true,
        }),
      ).toHaveCount(0);
      await details
        .getByRole("button", { name: "01-gallery.png", exact: true })
        .click();
      const preview = page.getByRole("dialog", {
        name: "01-gallery.png",
        exact: true,
      });
      await expect(
        preview.getByRole("img", { name: "01-gallery.png", exact: true }),
      ).toBeVisible();
      await preview
        .getByRole("button", { name: "Zoom in", exact: true })
        .click();
      await expect(preview.locator("output")).toHaveText("125%");
      await preview.getByRole("button", { name: "Next", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "02-historical.txt", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("dialog", { name: "02-historical.txt", exact: true }),
      ).toHaveCount(0);
      await expect(details).toBeVisible();
      await details
        .getByRole("textbox", { name: "Search", exact: true })
        .fill("gallery");
      await expect(
        details.getByRole("button", { name: "02-historical.txt", exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath("attachment-gallery.png"),
      });
      await details
        .getByRole("button", { name: "Go to usage", exact: true })
        .click();
      await expect(details).toHaveCount(0);
      await expect(page.locator(".tiptap img").first()).toBeInViewport();
    });

async function resetEditorBlocks(
  page: Page,
  content = fixture.editorBlocks.content,
) {
  await api(page.request, "/pages/actions/update", "POST", {
    pageId: fixture.editorBlocks.pageId,
    format: "json",
    operation: "replace",
    content,
  });
  await page.goto(fixture.editorBlocks.route);
}

test("live footnotes create, edit, search, conflict and survive reload", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  await resetEditorBlocks(page);
  const footer = page.locator('section[role="doc-endnotes"]');
  await expect(
    footer.getByText("First canonical note", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[role="doc-noteref"]')).toHaveText(["1", "2"]);
  await page
    .getByTestId("page-state-segmented-control")
    .locator("label")
    .filter({ hasText: /^Edit$/ })
    .click();
  await expect(
    footer.getByRole("button", { name: "Edit", exact: true }).first(),
  ).toBeVisible();
  const body = page.getByRole("textbox", { name: "Editor", exact: true });
  const note = footer.getByRole("textbox", { name: "Footnote 3", exact: true });
  const selectionTrace: unknown[] = [];
  const recordSelection = async (stage: string) => {
    selectionTrace.push(
      await body.evaluate((element, label) => {
        const editor = (element as any).editor;
        const selection = window.getSelection();
        return {
          stage: label,
          dom: {
            anchor: selection?.anchorNode?.textContent?.slice(0, 200),
            offset: selection?.anchorOffset,
          },
          model: editor?.state.selection.toJSON(),
          parent: editor?.state.selection.$from.parent.type.name,
          path: editor?.state.selection.$from.path
            .filter((value: any) => value?.type?.name)
            .map((value: any) => value.type.name),
          paragraphs: [...element.querySelectorAll(":scope > p")].map(
            (paragraph) => paragraph.textContent,
          ),
        };
      }, stage),
    );
  };
  try {
    await body.locator(":scope > p").last().click();
    await recordSelection("click");
    await page.keyboard.press("Control+End");
    await expect
      .poll(() =>
        body.evaluate((element) => {
          const selected = window.getSelection()?.anchorNode;
          const selectedParagraph = selected?.parentElement?.closest("p");
          return (
            selectedParagraph === element.querySelector(":scope > p:last-child")
          );
        }),
      )
      .toBe(true);
    await recordSelection("Control+End");
    await page.keyboard.press("Enter");
    await recordSelection("Enter");
    await page.keyboard.type("/Footnote");
    await recordSelection("slash");
    await page
      .locator("#slash-command")
      .getByRole("button", { name: /^Footnote/ })
      .click();
    await recordSelection("created");
    await expect(note).toBeVisible();
  } finally {
    await info.attach("footnote-selection", {
      body: Buffer.from(JSON.stringify(selectionTrace)),
      contentType: "application/json",
    });
  }
  await note.fill("Browser-created footnote");
  await footer.getByRole("button", { name: "Save", exact: true }).click();
  await body.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Control+z");
  await expect(
    footer.getByText("Browser-created footnote", { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(
    footer.getByText("Browser-created footnote", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[role="doc-noteref"]')).toHaveText([
    "1",
    "2",
    "3",
  ]);
  await expect
    .poll(
      async () =>
        JSON.stringify(
          (
            await api(
              page.request,
              `/pages/info?pageId=${fixture.editorBlocks.pageId}`,
            )
          ).content,
        ),
      { timeout: 55000 },
    )
    .toContain("Browser-created footnote");
  await page.goto(
    `${fixture.editorBlocks.route}?find=${encodeURIComponent("Browser-created footnote")}`,
  );
  await expect(footer.locator(".search-result-current")).toHaveText(
    "Browser-created footnote",
  );
  await page.screenshot({ path: info.outputPath("footnotes-search.png") });
  await page
    .getByRole("button", { name: "Close (Escape)", exact: true })
    .click();
  const first = footer.locator("li").first();
  await first.getByRole("button", { name: "Edit", exact: true }).click();
  await first.getByRole("textbox").fill("Local unsaved draft");
  const context = await browser.newContext({ storageState: sessions.editor });
  try {
    const other = await context.newPage();
    await other.goto(fixture.editorBlocks.route);
    const remote = other.locator('section[role="doc-endnotes"] li').first();
    await remote.getByRole("button", { name: "Edit", exact: true }).click();
    await remote.getByRole("textbox").fill("Concurrent canonical note");
    await remote.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(
        async () =>
          JSON.stringify(
            (
              await api(
                page.request,
                `/pages/info?pageId=${fixture.editorBlocks.pageId}`,
              )
            ).content,
          ),
        { timeout: 55000 },
      )
      .toContain("Concurrent canonical note");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(first.getByRole("alert")).toBeVisible();
    await expect(first.getByRole("textbox")).toHaveValue("Local unsaved draft");
    await first.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      first.getByText("Concurrent canonical note", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
  await page.reload();
  await expect(
    footer.getByText("Browser-created footnote", { exact: true }),
  ).toBeVisible();
});

test("live tabs persist edits, reveal hidden matches and present databases read-only", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const content = structuredClone(fixture.editorBlocks.content);
  content.content[0].content[1].content.push({
    type: "databaseEmbed",
    attrs: { databaseId: fixture.databaseId },
  });
  await resetEditorBlocks(page, content);
  const tabs = page.locator("[data-docmost-tabs-scope]").first();
  await expect(
    tabs.getByText("Visible tab evidence", { exact: true }),
  ).toBeVisible();
  await tabs.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(
    tabs.getByText("Hidden tab evidence", { exact: true }),
  ).toBeVisible();
  await page
    .getByTestId("page-state-segmented-control")
    .locator("label")
    .filter({ hasText: /^Edit$/ })
    .click();
  await expect(
    tabs.getByRole("button", { name: "Tab actions", exact: true }),
  ).toBeVisible();
  await expect(
    tabs.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("button", { name: "Tab actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename", exact: true });
  await rename
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Renamed live tab");
  await rename.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.stringify(
          (
            await api(
              page.request,
              `/pages/info?pageId=${fixture.editorBlocks.pageId}`,
            )
          ).content,
        ),
      { timeout: 55000 },
    )
    .toContain("Renamed live tab");
  await page.goto(
    `${fixture.editorBlocks.route}?find=${encodeURIComponent("Hidden tab evidence")}`,
  );
  await expect(tabs.locator(".search-result-current")).toBeVisible();
  await expect(
    tabs.getByRole("tab", { name: "Renamed live tab", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Close (Escape)", exact: true })
    .click();
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Present page", exact: true })
    .click();
  const presentation = page.getByRole("dialog", {
    name: "Present page",
    exact: true,
  });
  await expect(presentation).toBeVisible();
  await presentation
    .getByRole("tab", { name: "Renamed live tab", exact: true })
    .click();
  await expect(
    presentation.getByText("Rows: 900", { exact: true }),
  ).toBeVisible();
  await expect(
    presentation.getByRole("button", { name: "Add row", exact: true }),
  ).toHaveCount(0);
  await expect(presentation.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(
    presentation.getByRole("button", { name: "Tab actions", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("tabs-presentation-readonly.png"),
  });
  await presentation
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const context = await browser.newContext({ storageState: sessions.reader });
  try {
    const reader = await context.newPage();
    await reader.goto(fixture.editorBlocks.route);
    await reader
      .getByRole("tab", { name: "Renamed live tab", exact: true })
      .click();
    await expect(
      reader.getByText("Hidden tab evidence", { exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByRole("button", { name: "Tab actions", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("live empty template fills the current page and survives reload", async ({
  page,
  browser,
}, info) => {
  const target = await api(page.request, "/pages", "POST", {
    spaceId: fixture.spaceId,
    parentPageId: fixture.emptyTemplates.parentId,
    title: `Keep template title ${info.project.name}`,
  });
  await page.goto(`/s/${fixture.emptyTemplates.spaceSlug}/p/${target.slugId}`);
  await page
    .getByTestId("page-state-segmented-control")
    .locator("label")
    .filter({ hasText: /^Edit$/ })
    .click();
  await page
    .getByRole("button", { name: "Use a template", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Use a template",
    exact: true,
  });
  await picker
    .getByRole("button", { name: /Reusable regular template/ })
    .click();
  await expect(
    picker.getByRole("textbox", { name: "Page title", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("empty-template-picker.png") });
  await picker.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Editor", exact: true }),
  ).toContainText(fixture.emptyTemplates.text);
  await expect(page.getByLabel("Title", { exact: true })).toHaveText(
    target.title,
  );
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Editor", exact: true }),
  ).toContainText(fixture.emptyTemplates.text);
  await expect(
    page.getByRole("button", { name: "Use a template", exact: true }),
  ).toHaveCount(0);
  const empty = await api(page.request, "/pages", "POST", {
    spaceId: fixture.spaceId,
    title: "Reader empty template target",
  });
  const readerContext = await browser.newContext({
    storageState: sessions.reader,
  });
  try {
    const reader = await readerContext.newPage();
    await reader.goto(
      `/s/${fixture.emptyTemplates.spaceSlug}/p/${empty.slugId}`,
    );
    await expect(
      reader.getByRole("textbox", { name: "Editor", exact: true }),
    ).toHaveAttribute("contenteditable", "false");
    await expect(
      reader.getByRole("button", { name: "Use a template", exact: true }),
    ).toHaveCount(0);
  } finally {
    await readerContext.close();
  }
});

test("live empty template preserves a collaborator's new content", async ({
  page,
  context,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem("mantine-color-scheme-value", "dark"),
  );
  const target = await api(page.request, "/pages", "POST", {
    spaceId: fixture.spaceId,
    parentPageId: fixture.emptyTemplates.parentId,
    title: "Concurrent empty template target",
  });
  const route = `/s/${fixture.emptyTemplates.spaceSlug}/p/${target.slugId}`;
  await page.goto(route);
  await expect(page.locator("html")).toHaveAttribute(
    "data-mantine-color-scheme",
    "dark",
  );
  await page
    .getByTestId("page-state-segmented-control")
    .locator("label")
    .filter({ hasText: /^Edit$/ })
    .click();
  await page
    .getByRole("button", { name: "Use a template", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Use a template",
    exact: true,
  });
  await picker
    .getByRole("button", { name: /Reusable regular template/ })
    .click();
  const other = await context.newPage();
  try {
    await other.goto(route);
    await other
      .getByTestId("page-state-segmented-control")
      .locator("label")
      .filter({ hasText: /^Edit$/ })
      .click();
    const editor = other.getByRole("textbox", { name: "Editor", exact: true });
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.click();
    await other.keyboard.type("Concurrent content must survive");
    await expect(
      page.getByRole("textbox", { name: "Editor", exact: true }),
    ).toContainText("Concurrent content must survive");
    await picker.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(
      page.getByText(
        "The page is no longer empty. Your content has been preserved.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("empty-template-concurrent-mobile-dark.png"),
    });
    const saved = await api(page.request, `/pages/info?pageId=${target.id}`);
    expect(JSON.stringify(saved.content)).toContain(
      "Concurrent content must survive",
    );
    expect(JSON.stringify(saved.content)).not.toContain(
      fixture.emptyTemplates.text,
    );
  } finally {
    await other.close();
  }
});

test("live database description collapses without replacing its editor and reveals search matches", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: sessions.reader,
    viewport: { width: 1100, height: 650 },
  });
  try {
    const page = await context.newPage();
    await open(page);
    const body = page.getByRole("textbox", { name: "Editor", exact: true });
    await expect(
      page.getByRole("button", { name: "Show full description", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".editor-container [data-editor-page-id]"),
    ).toHaveCount(1);
    const original = await body.elementHandle();
    await page
      .getByRole("button", { name: "Show full description", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Collapse description", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await page
      .getByRole("button", { name: "Collapse description", exact: true })
      .click();
    expect(
      await body.evaluate((element, initial) => element === initial, original),
    ).toBe(true);
    await page.goto(
      `${fixture.route}?find=Database%20description%20paragraph%2014`,
    );
    await expect(body.locator(".search-result-current")).toHaveText(
      "Database description paragraph 14",
    );
    await expect(
      page.getByRole("button", { name: "Collapse description", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(body.locator(".search-result-current")).toBeInViewport();
  } finally {
    await context.close();
  }
});

for (const recordMode of ["read", "edit"] as const) {
  test(`live record editor saves body and title without changing the table editor or route (${recordMode})`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120000);
    if (recordMode === "edit") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() =>
        localStorage.setItem("mantine-color-scheme-value", "dark"),
      );
    }
    const savedText = `Record sidebar saved content ${info.project.name} ${recordMode}`;
    const currentUser = (await api(page.request, "/users/me")).user;
    await api(page.request, "/users/update", "POST", {
      pageEditModeByPageId: {
        ...currentUser.settings?.preferences?.pageEditModeByPageId,
        [fixture.databasePageId]: recordMode,
        [fixture.ids[103]]: recordMode,
      },
    });
    await open(page);
    const rootBody = page
      .getByRole("textbox", { name: "Editor", exact: true })
      .first();
    await expect(rootBody).toHaveAttribute(
      "contenteditable",
      String(recordMode === "edit"),
    );
    const initialDescription = await rootBody.textContent();
    const initialMode = await rootBody.getAttribute("contenteditable");
    const tablePath = new URL(page.url()).pathname;
    await page.getByRole("link", { name: "Row 0103", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`record=${fixture.ids[103]}`));
    const drawer = page.getByRole("dialog", { name: "Record", exact: true });
    await expect(drawer).toBeVisible();
    await drawer
      .getByTestId("page-state-segmented-control")
      .locator("label")
      .filter({ hasText: /^Edit$/ })
      .click();
    const body = drawer.getByRole("textbox", { name: "Editor", exact: true });
    await expect(body).toHaveAttribute("contenteditable", "true");
    const originalBodyText = await body.textContent();
    await body.locator(":scope > p").last().click();
    await body.press("Control+End");
    await expect(body).toBeFocused();
    await body.press("Enter");
    await body.pressSequentially(savedText);
    await expect(body).toContainText(originalBodyText!);
    await body.focus();
    await page.keyboard.press("Control+f");
    const find = page.getByRole("textbox", { name: "Find", exact: true });
    await expect(find).toHaveCount(1);
    await find.fill(savedText);
    await expect(body.locator(".search-result-current")).toHaveText(savedText);
    await find.press("Escape");
    await expect(drawer).toBeVisible();
    await expect(rootBody.locator(".search-result")).toHaveCount(0);
    await drawer
      .getByLabel("Title", { exact: true })
      .fill("Row 0103 edited in drawer");
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    await expect
      .poll(
        async () => {
          const value = await api(
            page.request,
            `/pages/info?pageId=${fixture.ids[103]}`,
          );
          return (
            value.title === "Row 0103 edited in drawer" &&
            JSON.stringify(value.content).includes(savedText)
          );
        },
        { timeout: 55000 },
      )
      .toBe(true);
    expect(new URL(page.url()).pathname).toBe(tablePath);
    expect(new URL(page.url()).searchParams.has("record")).toBe(false);
    await expect(rootBody).toHaveText(initialDescription);
    await expect(rootBody).toHaveAttribute("contenteditable", initialMode!);
    await page
      .getByRole("link", { name: "Row 0103 edited in drawer", exact: true })
      .click();
    await expect(
      drawer.getByRole("textbox", { name: "Editor", exact: true }),
    ).toContainText(savedText);
    await page.screenshot({
      path: info.outputPath(`record-editor-${recordMode}.png`),
    });
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    const context = await browser.newContext({
      storageState: sessions.reader,
      viewport:
        recordMode === "edit"
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
    });
    try {
      const reader = await context.newPage();
      if (recordMode === "edit")
        await reader.addInitScript(() =>
          localStorage.setItem("mantine-color-scheme-value", "dark"),
        );
      await reader.goto(`${fixture.route}?record=${fixture.ids[103]}`);
      const readDrawer = reader.getByRole("dialog", {
        name: "Record",
        exact: true,
      });
      await expect(
        readDrawer.getByRole("textbox", { name: "Editor", exact: true }),
      ).toHaveAttribute("contenteditable", "false");
      await expect(
        readDrawer.getByTestId("page-state-segmented-control"),
      ).toHaveCount(0);
      await expect(
        readDrawer.getByText(savedText, { exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test("live record drawer preserves table context and supports direct links", async ({
  page,
}) => {
  await open(page);
  const title = page.getByRole("link", { name: "Row 0101", exact: true });
  await title.click();
  const drawer = page.getByRole("dialog", { name: "Record", exact: true });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByText("Synthetic row 101", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${fixture.ids[101]}`));
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Record", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Record", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.getByText("Rows: 900", { exact: true })).toBeVisible();
  await expect(cell(page, 101)).toBeVisible();
});

test("live direct record navigation seeks beyond loaded rows", async ({
  page,
}) => {
  await page.goto(`${fixture.route}?record=${fixture.ids[800]}`);
  const drawer = page.getByRole("dialog", { name: "Record", exact: true });
  await expect(
    drawer.getByText("Synthetic row 800", { exact: true }),
  ).toBeVisible();
  await drawer.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    drawer.getByText("Synthetic row 801", { exact: true }),
  ).toBeVisible();
  await drawer.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(
    drawer.getByText("Synthetic row 800", { exact: true }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"])
  for (const width of [320, 390, 768, 1440]) {
    test(`live responsive database ${theme} ${width}`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        (value) => localStorage.setItem("mantine-color-scheme-value", value),
        theme,
      );
      await page.setViewportSize({ width, height: 1000 });
      await open(page);
      await expect(page.locator("html")).toHaveAttribute(
        "data-mantine-color-scheme",
        theme,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await gridViewport(page).evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: /^View settings/ }).click();
      await expect(
        page.getByRole("dialog", { name: "View settings", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Add sort", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Sort property 1" }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`database-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "Close", exact: true }).click();
      expect(errors).toEqual([]);
    });
  }

test("live editing preserves loaded pages, scroll and one save", async ({
  page,
}, info) => {
  await open(page);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  const viewport = gridViewport(page);
  await viewport.evaluate((element) => {
    element.scrollTop = 2400;
  });
  const targets = page.locator(`[data-database-cell-key$=":${notesId}"]`);
  await expect
    .poll(() => targets.first().getAttribute("data-database-cell-key"))
    .not.toBe(`${fixture.ids[100]}:${notesId}`);
  // The first virtual row is overscan above the viewport and is not a user target.
  const key = await targets.evaluateAll((cells) => {
    const viewport = cells[0]
      ?.closest(".mantine-ScrollArea-viewport")
      ?.getBoundingClientRect();
    if (!viewport) return null;
    return (
      cells
        .find((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.top >= viewport.top + 80 && box.bottom <= viewport.bottom - 40
          );
        })
        ?.getAttribute("data-database-cell-key") ?? null
    );
  });
  expect(key).toBeTruthy();
  const stable = page.locator(`[data-database-cell-key="${key}"]`);
  const initialGeometry = {
    cell: await stable.boundingBox(),
    viewport: await viewport.boundingBox(),
    scrollTop: await viewport.evaluate((element) => element.scrollTop),
  };
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith("/cells"))
      writes++;
  });
  await stable.click();
  await stable.press("F2");
  await stable.getByRole("textbox").fill("Saved without jumping");
  const before = await viewport.evaluate((element) => element.scrollTop);
  expect(Math.abs(before - initialGeometry.scrollTop)).toBeLessThanOrEqual(100);
  await stable.getByRole("textbox").press("Tab");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await info.attach("grid-edit-focus", {
    body: Buffer.from(
      JSON.stringify({
        key,
        initialGeometry,
        before,
        after: await viewport.evaluate((element) => element.scrollTop),
        cell: await stable.boundingBox(),
      }),
    ),
    contentType: "application/json",
  });
  expect(writes).toBe(1);
  expect(
    await viewport.evaluate((element) => element.scrollTop),
  ).toBeGreaterThanOrEqual(before - 100);
  await expect(
    page.getByRole("button", { name: "Load more", exact: true }),
  ).toBeVisible();
});

test("live row ACL disables controls for a reader and a denied writer row", async ({
  page,
  browser,
}) => {
  await open(page);
  await cell(page, 100).press("F2");
  await expect(cell(page, 100).getByRole("textbox")).toHaveCount(0);
  await expect(
    cell(page, 100)
      .locator("xpath=..")
      .getByRole("checkbox", { name: "Select row" }),
  ).toBeDisabled();
  const context = await browser.newContext({ storageState: sessions.reader });
  const reader = await context.newPage();
  try {
    await open(reader);
    await cell(reader, 101).press("F2");
    await expect(cell(reader, 101).getByRole("textbox")).toHaveCount(0);
    await expect(
      reader.getByRole("textbox", { name: "New column name" }),
    ).toHaveCount(0);
    await reader.getByRole("button", { name: /^View settings/ }).click();
    await expect(
      reader.getByRole("dialog", { name: "View settings", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("live decimals, date ranges and time zones persist canonically", async ({
  page,
}) => {
  await open(page);
  const amount = cell(page, 101, 1);
  await amount.press("F2");
  await amount.getByRole("textbox").fill("10.25");
  await amount.getByRole("textbox").press("Enter");
  await expect
    .poll(
      async () =>
        (await row(page, 101)).cells.find(
          (item: any) => item.propertyId === fixture.properties[1].id,
        ).value,
    )
    .toBe(10.25);
  const date = cell(page, 101, 2);
  await date.press("F2");
  await date.getByRole("switch", { name: "Date range" }).check();
  await date
    .getByLabel("Date: Row 0101: End", { exact: true })
    .fill("2026-10-14");
  await date.getByRole("switch", { name: "Include time" }).check();
  await date.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await row(page, 101)).cells.find(
          (item: any) => item.propertyId === fixture.properties[2].id,
        ).value,
    )
    .toEqual({
      start: "2026-10-12T21:00:00.000Z",
      end: "2026-10-13T21:00:00.000Z",
      timeZone: "Europe/Moscow",
    });
  await expect(
    date.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
  await date.press("F2");
  await date.getByRole("switch", { name: "Include time" }).uncheck();
  await date.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await row(page, 101)).cells.find(
          (item: any) => item.propertyId === fixture.properties[2].id,
        ).value,
    )
    .toEqual({ start: "2026-10-13", end: "2026-10-14" });
});

test("live select keyboard saves once and safe links expose device handlers", async ({
  page,
}) => {
  await open(page);
  const target = cell(page, 101, 8);
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith("/cells"))
      writes++;
  });
  await target.press("F2");
  await target.getByRole("textbox").click();
  await target.getByRole("textbox").press("ArrowDown");
  await target.getByRole("textbox").press("Enter");
  await expect.poll(() => writes).toBe(1);
  await expect(cell(page, 101, 4).getByRole("link")).toHaveAttribute(
    "href",
    "https://example.test/path",
  );
  await expect(cell(page, 101, 5).getByRole("link")).toHaveAttribute(
    "href",
    "mailto:synthetic@example.test",
  );
  await expect(cell(page, 101, 6).getByRole("link")).toHaveAttribute(
    "href",
    /^tel:/,
  );
});

test("live network failure preserves the draft and retry persists to PostgreSQL", async ({
  page,
}, info) => {
  await open(page);
  const target = cell(page, 101);
  await target.press("F2");
  const editor = target.getByRole("textbox");
  await editor.fill("Preserved after network failure");
  let injectedFailures = 0;
  await page.route(
    "**/cells",
    (route) => {
      injectedFailures++;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      });
    },
    { times: 1 },
  );
  await editor.press("Tab");
  try {
    await expect(
      page.getByRole("status").filter({ hasText: "Failed to update data" }),
    ).toBeVisible();
  } finally {
    await info.attach("network-failure-fixture", {
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          injectedFailures,
          worker: await page.evaluate(() =>
            Boolean(navigator.serviceWorker?.controller),
          ),
        }),
      ),
    });
  }
  await expect(editor).toHaveValue("Preserved after network failure");
  await editor.press("Tab");
  await expect
    .poll(
      async () =>
        (await row(page, 101)).cells.find(
          (item: any) => item.propertyId === notesId,
        ).value,
    )
    .toBe("Preserved after network failure");
});

test("live delayed response keeps the next editor open", async ({ page }) => {
  await open(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/cells",
    async (route) => {
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  await cell(page, 101).press("F2");
  await cell(page, 101).getByRole("textbox").fill("First intention");
  await cell(page, 101).getByRole("textbox").press("Tab");
  await cell(page, 102).press("F2");
  await cell(page, 102).getByRole("textbox").fill("Second draft");
  release();
  await expect
    .poll(
      async () =>
        (await row(page, 101)).cells.find(
          (item: any) => item.propertyId === notesId,
        ).value,
    )
    .toBe("First intention");
  await expect(cell(page, 102).getByRole("textbox")).toHaveValue(
    "Second draft",
  );
  await cell(page, 102).getByRole("textbox").press("Escape");
});

test("live TSV preserves blank rows and retries only the failed row", async ({
  page,
}) => {
  await open(page);
  let batches = 0;
  await page.route("**/rows/batch", async (route) => {
    if (++batches === 2)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      });
    else await route.continue();
  });
  await cell(page, 101).evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData(
      "text",
      Array.from({ length: 26 }, (_, index) =>
        index === 1
          ? ""
          : index === 0
            ? "first"
            : index === 25
              ? "last"
              : `Pasted ${index}`,
      ).join("\n"),
    );
    const event = new ClipboardEvent("paste", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    // Firefox strips constructor-supplied data from an untrusted paste event.
    Object.defineProperty(event, "clipboardData", { value: transfer });
    if (event.clipboardData?.getData("text") !== transfer.getData("text"))
      throw new Error("The synthetic clipboard fixture lost its payload");
    element.dispatchEvent(event);
  });
  await expect(
    page.getByText("1 rows failed. Successful rows were saved."),
  ).toBeVisible();
  const before = await row(page, 101);
  expect(
    before.cells.find((item: any) => item.propertyId === notesId).value,
  ).toBe("first");
  expect(
    (await row(page, 102)).cells.find(
      (item: any) => item.propertyId === notesId,
    )?.value ?? null,
  ).toBe(null);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await row(page, 126)).cells.find(
          (item: any) => item.propertyId === notesId,
        ).value,
    )
    .toBe("last");
  expect(batches).toBe(3);
  expect(
    (await row(page, 101)).cells.find(
      (item: any) => item.propertyId === notesId,
    ).revision,
  ).toBe(
    before.cells.find((item: any) => item.propertyId === notesId).revision,
  );
});
test("live two clients preserve view conflicts and explicitly apply the draft", async ({
  page,
  browser,
}) => {
  await open(page);
  const otherContext = await browser.newContext({
    storageState: sessions.editor,
  });
  const other = await otherContext.newPage();
  try {
    await open(other);
    await selectShared(page);
    await selectShared(other);
    await editViewName(page, "First client");
    await page
      .getByRole("button", { name: "Save for everyone", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await api(page.request, `/databases/${fixture.databaseId}/views`)
          ).find((view: any) => view.id === fixture.viewId).name,
      )
      .toBe("First client");
    await editViewName(other, "Second client");
    await other
      .getByRole("button", { name: "Save for everyone", exact: true })
      .click();
    await expect(
      other.getByText(
        "This view changed in another session. Your draft is preserved.",
      ),
    ).toBeVisible();
    await expectViewName(other, "Second client");
    await other
      .getByRole("button", { name: "Apply my changes", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await api(page.request, `/databases/${fixture.databaseId}/views`)
          ).find((view: any) => view.id === fixture.viewId).name,
      )
      .toBe("Second client");
  } finally {
    await otherContext.close();
  }
});

test("live empty database, no filter results and failed queries are distinct", async ({
  page,
}) => {
  await page.goto(fixture.otherRoute);
  await expect(
    page.getByText("This database is empty", { exact: true }),
  ).toBeVisible();
  await open(page);
  await page.getByRole("button", { name: /^View settings/ }).click();
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Value", exact: true })
    .fill("No row has this title");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByText("No matching rows", { exact: true }),
  ).toBeVisible();
  await page.route("**/rows?**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Failed to load data" }),
  ).toBeVisible();
});

for (const undo of [true, false])
  test(`live deletion retains six seconds after navigation and ${undo ? "undo" : "original database"}`, async ({
    page,
  }, info) => {
    await open(page);
    await cell(page, 104)
      .locator("xpath=..")
      .getByRole("checkbox", { name: "Select row", exact: true })
      .check();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const renderedCellsBefore = await page
      .locator("[data-database-cell-key]")
      .count();
    const started = Date.now();
    const actionTimes: Array<{ action: string; elapsedMs: number }> = [];
    await page
      .getByRole("dialog", { name: "Delete", exact: true })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    actionTimes.push({ action: "confirm", elapsedMs: Date.now() - started });
    const renderedCellsAfter = await page
      .locator("[data-database-cell-key]")
      .count();
    await info.attach("delete-render-bound", {
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          renderedCellsBefore,
          renderedCellsAfter,
          confirmationMs: Date.now() - started,
        }),
      ),
    });
    expect(renderedCellsAfter).toBeLessThanOrEqual(renderedCellsBefore);
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeVisible();
    actionTimes.push({
      action: "undo-visible",
      elapsedMs: Date.now() - started,
    });
    await page
      .getByRole("treeitem", { name: "Second database", exact: true })
      .getByRole("link")
      .click();
    actionTimes.push({ action: "navigate", elapsedMs: Date.now() - started });
    let navigationMs = 0;
    try {
      await expect(
        page.getByText("This database is empty", { exact: true }),
      ).toBeVisible();
    } finally {
      navigationMs = Date.now() - started;
      actionTimes.push({
        action: "destination-visible",
        elapsedMs: navigationMs,
      });
      await info.attach("delete-action-timing", {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(actionTimes)),
      });
    }
    expect(navigationMs).toBeLessThan(5000);
    await page.waitForTimeout(Math.max(0, 4500 - (Date.now() - started)));
    expect(await row(page, 104)).toBeTruthy();
    if (undo)
      await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForTimeout(Math.max(0, 6500 - (Date.now() - started)));
    if (undo) expect(await row(page, 104)).toBeTruthy();
    else
      await expect.poll(async () => Boolean(await row(page, 104))).toBe(false);
    const otherRows = await api(
      page.request,
      `/databases/${fixture.otherDatabaseId}/rows?limit=100`,
    );
    expect(otherRows.items).toHaveLength(0);
  });

for (const [theme, width] of [
  ["light", 1440],
  ["dark", 390],
] as const)
  test(`live collaborative document blocks persist, copy and undo ${theme} ${width}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(90000);
    const editorApi = await playwrightRequest.newContext({
      baseURL: process.env.DATABASE_LIVE_URL,
      storageState: sessions.editor,
    });
    const adminApi = await playwrightRequest.newContext({
      baseURL: process.env.DATABASE_LIVE_URL,
      storageState: sessions.admin,
    });
    const ownedPages: string[] = [];
    const primaryBefore =
      (await api(editorApi, "/users/me")).user.settings?.preferences
        ?.pageEditModeByPageId ?? {};
    const peerBefore =
      (await api(adminApi, "/users/me")).user.settings?.preferences
        ?.pageEditModeByPageId ?? {};
    let peerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    const updatedNote = "Live footnote edited by the first user";
    const remoteNote = "Remote footnote must survive the stale draft";
    const peerText = "Hidden tab original — peer edit";
    const editorOf = (target: Page) =>
      target.getByRole("textbox", { name: "Editor", exact: true });
    const pageRoute = (slugId: string) =>
      `/s/${fixture.emptyTemplates.spaceSlug}/p/${slugId}`;
    try {
      const text = (value: string) => ({
        type: "paragraph",
        content: [{ type: "text", text: value }],
      });
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Live footnote source " },
              {
                type: "footnote",
                attrs: { id: randomUUID() },
                content: [{ type: "text", text: "Initial live footnote" }],
              },
            ],
          },
          {
            type: "tabs",
            attrs: { id: randomUUID() },
            content: [
              {
                type: "tabItem",
                attrs: { id: randomUUID(), title: "Overview" },
                content: [text("Primary tab original")],
              },
              {
                type: "tabItem",
                attrs: { id: randomUUID(), title: "Details" },
                content: [text("Hidden tab original")],
              },
            ],
          },
          text("Русский English العربية"),
          text("مرحبا English русский"),
          text("שלום English русский"),
        ],
      };
      const source = await api(editorApi, "/pages", "POST", {
        spaceId: fixture.spaceId,
        parentPageId: fixture.emptyTemplates.parentId,
        title: `Collaborative blocks ${info.project.name} ${theme}`,
      });
      ownedPages.push(source.id);
      await api(editorApi, "/pages/actions/update", "POST", {
        pageId: source.id,
        content,
        format: "json",
        operation: "replace",
      });
      const target = await api(editorApi, "/pages", "POST", {
        spaceId: fixture.spaceId,
        parentPageId: fixture.emptyTemplates.parentId,
        title: `Copied blocks ${info.project.name} ${theme}`,
      });
      ownedPages.push(target.id);
      await api(editorApi, "/pages/actions/update", "POST", {
        pageId: target.id,
        content: { type: "doc", content: [text("Copy target seed")] },
        format: "json",
        operation: "replace",
      });
      const modes = Object.fromEntries(ownedPages.map((id) => [id, "edit"]));
      await api(editorApi, "/users/update", "POST", {
        pageEditModeByPageId: { ...primaryBefore, ...modes },
      });
      await api(adminApi, "/users/update", "POST", {
        pageEditModeByPageId: { ...peerBefore, ...modes },
      });
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (value) => localStorage.setItem("mantine-color-scheme-value", value),
        theme,
      );
      peerContext = await browser.newContext({
        baseURL: process.env.DATABASE_LIVE_URL,
        storageState: sessions.admin,
        viewport: { width, height: 900 },
      });
      await peerContext.addInitScript(
        (value) => localStorage.setItem("mantine-color-scheme-value", value),
        theme,
      );
      const peer = await peerContext.newPage();
      await Promise.all([
        page.goto(pageRoute(source.slugId)),
        peer.goto(pageRoute(source.slugId)),
      ]);
      const primaryEditor = editorOf(page);
      const peerEditor = editorOf(peer);
      await expect(primaryEditor).toHaveAttribute("contenteditable", "true");
      await expect(peerEditor).toHaveAttribute("contenteditable", "true");
      const primaryNotes = page.locator('[role="doc-endnotes"]');
      const peerNotes = peer.locator('[role="doc-endnotes"]');
      await expect(primaryNotes).toContainText("Initial live footnote");
      await expect(peerNotes).toContainText("Initial live footnote");
      const primaryTabs = primaryEditor.locator("[data-docmost-tabs-scope]");
      const peerTabs = peerEditor.locator("[data-docmost-tabs-scope]");
      await peerTabs.getByRole("tab", { name: "Details", exact: true }).click();
      await Promise.all([
        (async () => {
          await primaryNotes
            .getByRole("button", { name: "Edit", exact: true })
            .click();
          await primaryNotes.getByRole("textbox").fill(updatedNote);
          await primaryNotes
            .getByRole("button", { name: "Save", exact: true })
            .click();
        })(),
        (async () => {
          const paragraph = peerTabs.getByText("Hidden tab original", {
            exact: true,
          });
          await paragraph.click();
          await paragraph.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
          });
          await peer.keyboard.insertText(" — peer edit");
        })(),
      ]);
      await expect(primaryNotes).toContainText(updatedNote);
      await expect(peerNotes).toContainText(updatedNote);
      await expect(
        primaryTabs.getByRole("tab", { name: "Overview", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        peerTabs.getByRole("tab", { name: "Details", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(peerTabs).toContainText(peerText);
      await expect(primaryTabs).toContainText(peerText);
      await primaryTabs
        .getByRole("button", { name: "Tab actions", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      const rename = page.getByRole("dialog", { name: "Rename", exact: true });
      await rename
        .getByRole("textbox", { name: "Name", exact: true })
        .fill("Overview renamed");
      await rename.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        peerTabs.getByRole("tab", { name: "Overview renamed", exact: true }),
      ).toBeVisible();
      await expect(peerTabs).toContainText(peerText);
      await expect(
        peerTabs.getByRole("tab", { name: "Details", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      for (const [value, direction] of [
        ["Русский English العربية", "ltr"],
        ["مرحبا English русский", "rtl"],
        ["שלום English русский", "rtl"],
      ])
        await expect(primaryEditor.getByText(value, { exact: true })).toHaveCSS(
          "direction",
          direction,
        );
      await peerNotes
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      await peerNotes
        .getByRole("textbox")
        .fill("This stale draft must not overwrite a peer");
      await primaryNotes
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      await primaryNotes.getByRole("textbox").fill(remoteNote);
      await primaryNotes
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(peerEditor.locator('[role="doc-noteref"]')).toHaveAttribute(
        "title",
        remoteNote,
      );
      await expect(peerNotes.getByRole("textbox")).toHaveValue(
        "This stale draft must not overwrite a peer",
      );
      await peerNotes
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(peerNotes.getByRole("alert")).toBeVisible();
      await peerNotes
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(peerNotes).toContainText(remoteNote);
      await primaryEditor.focus();
      await primaryEditor.press("ControlOrMeta+a");
      const clipboard = await editorClipboard(primaryEditor, "copy");
      expect(clipboard["text/html"]).toContain('data-type="tabs"');
      expect(clipboard["text/html"]).toContain(remoteNote);
      expect(clipboard["text/html"]).toContain(peerText);
      await page.goto(pageRoute(target.slugId));
      const targetEditor = editorOf(page);
      await expect(targetEditor).toContainText("Copy target seed");
      await expect(targetEditor).toHaveAttribute("contenteditable", "true");
      await targetEditor.focus();
      await targetEditor.press("ControlOrMeta+a");
      await editorClipboard(targetEditor, "paste", clipboard);
      await expect(
        targetEditor.getByRole("tab", {
          name: "Overview renamed",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator('[role="doc-endnotes"]')).toContainText(
        remoteNote,
      );
      await targetEditor.press("ControlOrMeta+z");
      await expect(targetEditor).toContainText("Copy target seed");
      await expect(targetEditor.getByRole("tab")).toHaveCount(0);
      await targetEditor.press("ControlOrMeta+Shift+z");
      await expect(
        targetEditor.getByRole("tab", { name: "Details", exact: true }),
      ).toBeVisible();
      await expect(page.locator('[role="doc-endnotes"]')).toContainText(
        remoteNote,
      );
      await page.screenshot({
        path: info.outputPath(`collaborative-blocks-${theme}-${width}.png`),
        fullPage: true,
      });
      await peerContext.close();
      peerContext = undefined;
      await page.goto("/home");
      for (const pageId of ownedPages)
        await expect
          .poll(
            async () => {
              const saved = JSON.stringify(
                (await api(editorApi, `/pages/info?pageId=${pageId}`)).content,
              );
              return [remoteNote, peerText, "Overview renamed"].every((value) =>
                saved.includes(value),
              );
            },
            { timeout: 20000 },
          )
          .toBe(true);
      await page.goto(pageRoute(source.slugId));
      await expect(page.locator('[role="doc-endnotes"]')).toContainText(
        remoteNote,
      );
      await editorOf(page)
        .getByRole("tab", { name: "Details", exact: true })
        .click();
      await expect(editorOf(page)).toContainText(peerText);
    } finally {
      const cleanupErrors: string[] = [];
      const cleanup = async (label: string, action: () => Promise<unknown>) => {
        try {
          await action();
        } catch {
          cleanupErrors.push(label);
        }
      };
      await cleanup("close-primary", async () => {
        if (!page.isClosed()) await page.close();
      });
      await cleanup("close-peer", async () => {
        await peerContext?.close();
      });
      for (const pageId of ownedPages)
        await cleanup("remove-owned-page", () =>
          api(adminApi, "/pages/actions/delete", "POST", {
            pageId,
            permanentlyDelete: true,
          }),
        );
      await cleanup("restore-editor-preferences", () =>
        api(editorApi, "/users/update", "POST", {
          pageEditModeByPageId: primaryBefore,
        }),
      );
      await cleanup("restore-peer-preferences", () =>
        api(adminApi, "/users/update", "POST", {
          pageEditModeByPageId: peerBefore,
        }),
      );
      await Promise.all([editorApi.dispose(), adminApi.dispose()]);
      expect.soft(cleanupErrors).toEqual([]);
    }
  });

for (const mobileWidth of [0, 320, 390])
  test(`live advanced database formula, participants and file controls (${mobileWidth ? `mobile ${mobileWidth}` : "desktop"})`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(90000);
    const mobile = mobileWidth > 0;
    const advanced = fixture.advanced;
    const caseSuffix = mobile ? `mobile-${mobileWidth}` : "desktop";
    const formulaName = `Triple ${info.project.name} ${caseSuffix}`;
    const uploadedName = `uploaded-${info.project.name}-${caseSuffix}.txt`;
    const cleanupApi = await playwrightRequest.newContext({
      baseURL: process.env.DATABASE_LIVE_URL,
      storageState: sessions.editor,
    });
    const actionStart = Date.now();
    const actions: Array<{ action: string; elapsedMs: number }> = [];
    const mark = (action: string) =>
      actions.push({ action, elapsedMs: Date.now() - actionStart });
    let createdId: string | undefined;
    if (mobile) {
      await page.setViewportSize({ width: mobileWidth, height: 844 });
      await page.addInitScript(() =>
        localStorage.setItem("mantine-color-scheme-value", "dark"),
      );
    }
    const advancedCell = (name: string) =>
      page.locator(
        `[data-database-cell-key="${advanced.rowId}:${advanced.properties[name].id}"]`,
      );
    try {
      await api(
        cleanupApi,
        `/databases/${advanced.databaseId}/rows/${advanced.rowId}/cells`,
        "PATCH",
        {
          contractVersion: 4,
          cells: [
            {
              propertyId: advanced.properties.Files.id,
              value: [{ attachmentId: advanced.fileId }],
            },
          ],
        },
      );
      mark("baseline-restored");
      await page.goto(advanced.route);
      await expect(page.getByText("Rows: 305", { exact: true })).toBeVisible();
      mark("table-ready");
      await page.getByRole("textbox", { name: "View", exact: true }).click();
      await page
        .getByRole("option", { name: "Advanced view", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "View", exact: true }),
      ).toHaveValue("Advanced view");
      await expect(advancedCell("Double")).toHaveText("2");
      await advancedCell("Double").click({ timeout: 5000 });
      await info.attach("computed-cell-geometry", {
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify(
            await advancedCell("Double").evaluate((element) => {
              const rect = element.getBoundingClientRect();
              const viewport = element.closest(
                ".mantine-ScrollArea-viewport",
              ) as HTMLElement;
              const center = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              );
              return {
                cell: rect.toJSON(),
                viewport: viewport.getBoundingClientRect().toJSON(),
                scrollLeft: viewport.scrollLeft,
                hit: element === center || element.contains(center),
                centerElement: center?.tagName,
                centerClass: center?.className,
                rowCells: Array.from(element.parentElement!.children)
                  .slice(0, 2)
                  .map((cell) => cell.getBoundingClientRect().toJSON()),
              };
            }),
          ),
        ),
      });
      await expect(
        advancedCell("Double").locator(
          'input,textarea,[contenteditable="true"]',
        ),
      ).toHaveCount(0);
      const participants = advancedCell("Participants");
      await expect(participants).toContainText("QA Editor");
      await expect(participants).toContainText("QA Reader");
      const files = advancedCell("Files");
      await expect(
        files.getByRole("link", { name: "record-property.txt" }),
      ).toBeVisible();
      await files
        .getByRole("button", { name: "Edit", exact: true })
        .click({ timeout: 5000 });
      await files.locator('input[type="file"]').setInputFiles({
        name: uploadedName,
        mimeType: "text/plain",
        buffer: Buffer.from("Browser upload to a file property"),
      });
      await expect
        .poll(async () => {
          const context = await api(
            page.request,
            `/databases/rows/${advanced.rowId}/context`,
          );
          return context.cells.find(
            (cell: any) => cell.propertyId === advanced.properties.Files.id,
          ).value.length;
        })
        .toBe(2);
      await expect(
        files.getByRole("link", { name: uploadedName, exact: true }),
      ).toBeVisible();
      mark("file-uploaded");
      await page
        .getByRole("button", { name: "Add property", exact: true })
        .click();
      mark("property-creator-open");
      await page
        .getByRole("textbox", { name: "New column name", exact: true })
        .fill(formulaName);
      await page
        .getByRole("textbox", { name: "Property type", exact: true })
        .click();
      await page.getByRole("option", { name: "Formula", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Property type", exact: true }),
      ).toHaveValue("Formula");
      await expect(
        page.getByRole("button", { name: "Add property", exact: true }),
      ).toHaveAttribute("aria-expanded", "true");
      mark("formula-type-selected");
      await page.getByRole("button", { name: "Property", exact: true }).click();
      mark("formula-dialog-requested");
      const modal = page.getByRole("dialog", {
        name: formulaName,
        exact: true,
      });
      await expect(modal).toBeVisible();
      mark("formula-dialog-ready");
      await modal
        .getByRole("textbox", { name: "Expression", exact: true })
        .fill('add(1, "invalid")');
      await expect(
        modal.getByRole("textbox", { name: "Expression", exact: true }),
      ).toHaveValue('add(1, "invalid")');
      await expect(
        modal.getByRole("button", { name: "Save", exact: true }),
      ).toBeDisabled();
      await modal
        .getByRole("textbox", { name: "Expression", exact: true })
        .fill(`multiply(prop("${advanced.properties.Budget.id}"), 3)`);
      await modal.getByRole("button", { name: "Save", exact: true }).click();
      await expect(modal).toHaveCount(0);
      mark("formula-saved");
      const properties = await api(
        page.request,
        `/databases/${advanced.databaseId}/properties`,
      );
      createdId = properties.find(
        (property: any) => property.name === formulaName,
      )?.id;
      expect(createdId).toBeTruthy();
      const computed = page.locator(
        `[data-database-cell-key="${advanced.rowId}:${createdId}"]`,
      );
      await computed.click({ timeout: 5000 });
      await expect(computed).toHaveText("3");
      mark("reload-start");
      await page.reload();
      await expect(computed).toHaveText("3");
      mark("reload-ready");
      await computed.click({ timeout: 5000 });
      mark("screenshot-start");
      await page.screenshot({
        path: info.outputPath(
          `advanced-${mobile ? "mobile-dark" : "desktop-light"}.png`,
        ),
        fullPage: true,
      });
      mark("screenshot-ready");
      const readerContext = await browser.newContext({
        storageState: sessions.reader,
        viewport: page.viewportSize() ?? undefined,
      });
      try {
        const reader = await readerContext.newPage();
        await reader.goto(advanced.route);
        mark("reader-open");
        const readerFile = reader.locator(
          `[data-database-cell-key="${advanced.rowId}:${advanced.properties.Files.id}"]`,
        );
        await expect(
          readerFile.getByRole("link", {
            name: uploadedName,
          }),
        ).toBeVisible();
        mark("reader-file-ready");
        const downloadPromise = reader.waitForEvent("download");
        await readerFile
          .getByRole("link", {
            name: uploadedName,
          })
          .click({ timeout: 5000 });
        mark("download-clicked");
        expect((await downloadPromise).suggestedFilename()).toBe(uploadedName);
        mark("download-ready");
        await expect(
          readerFile.getByRole("button", { name: "Edit", exact: true }),
        ).toHaveCount(0);
        await expect(
          reader.getByRole("button", { name: "Add property", exact: true }),
        ).toHaveCount(0);
      } finally {
        await readerContext.close();
      }
    } finally {
      try {
        await info.attach("advanced-action-timing", {
          body: Buffer.from(JSON.stringify(actions)),
          contentType: "application/json",
        });
        if (!page.isClosed()) await page.close();
      } finally {
        try {
          try {
            if (createdId)
              await api(
                cleanupApi,
                `/databases/${advanced.databaseId}/properties/${createdId}`,
                "DELETE",
              );
          } finally {
            await api(
              cleanupApi,
              `/databases/${advanced.databaseId}/rows/${advanced.rowId}/cells`,
              "PATCH",
              {
                contractVersion: 4,
                cells: [
                  {
                    propertyId: advanced.properties.Files.id,
                    value: [{ attachmentId: advanced.fileId }],
                  },
                ],
              },
            );
          }
        } finally {
          await cleanupApi.dispose();
        }
      }
    }
  });
