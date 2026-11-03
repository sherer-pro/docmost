import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const scope =
  process.argv.find((arg) => arg.startsWith("--scope="))?.slice(8) ?? "all";
if (
  !["all", "export", "details", "reader", "history", "preferences"].includes(
    scope,
  )
)
  throw new Error("Unknown header panel scope");
const output = path.resolve(
  root,
  "../../artifacts/header-panels",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const coldCache = process.argv.includes("--cold-cache");
const setupOnly = process.argv.includes("--setup-only");
const cacheDir = coldCache
  ? path.join(output, "vite-cache")
  : path.resolve(root, "../../artifacts/header-panels/vite-cache");
process.chdir(root);
const sourceFiles = [
  "src/components/common/export-modal.tsx",
  "src/components/common/use-menu-modal-handoff.ts",
  "src/features/user/components/account-language.tsx",
  "src/features/user/components/account-theme.tsx",
  "src/features/page/components/header/page-header-menu.tsx",
  "src/features/page/components/page-details-modal.tsx",
  "src/features/page/components/page-details-modal.module.css",
  "src/features/attachments/components/page-attachments-gallery.tsx",
  "src/features/attachments/components/page-attachments-gallery.module.css",
  "src/features/attachments/components/media-lightbox.tsx",
  "src/features/database/components/header/database-header-menu.tsx",
  "src/features/page-history/components/history-modal.tsx",
  "src/features/page-history/components/history-list.tsx",
  "src/features/page-history/components/history-modal-body.tsx",
  "src/features/page-history/components/css/history.module.css",
  "public/locales/en-US/translation.json",
  "e2e/header-panels/fixture.tsx",
  "e2e/header-panels/run.mjs",
];
const sourceSnapshot = async () =>
  Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
const initialSources = await sourceSnapshot();
const preparationStarted = performance.now();
const preparation = {
  coldCache,
  cacheDir,
  durationMs: 0,
  staticImportsReady: false,
};
const server = await createServer({
  root,
  mode: "test",
  cacheDir,
  optimizeDeps: {
    entries: ["e2e/header-panels/fixture.html"],
    include: ["@mantine/modals", "react-helmet-async"],
  },
  server: { host: "127.0.0.1", port: 5209, strictPort: true, watch: null },
});
const results = [];
const networkDiagnostics = [];
const serverErrors = [];
const optimizerEvents = [];
const logServerInfo = server.config.logger.info.bind(server.config.logger);
server.config.logger.info = (message, options) => {
  if (/dependencies optimized|optimized dependencies changed/i.test(message))
    optimizerEvents.push({
      elapsedMs: Math.round(performance.now() - preparationStarted),
      message,
    });
  logServerInfo(message, options);
};
const logServerError = server.config.logger.error.bind(server.config.logger);
server.config.logger.error = (message, options) => {
  serverErrors.push({
    elapsedMs: Math.round(performance.now() - preparationStarted),
    message,
  });
  logServerError(message, options);
};
let browser;
let activePage;
const files = Array.from({ length: 60 }, (_, index) => ({
  id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  fileName: `sample-${String(index + 1).padStart(2, "0")}-long-file-name-without-spaces-${"a".repeat(48)}.${["wav", "png", "pdf", "mp4", "txt"][index % 5]}`,
  fileExt: `.${["wav", "png", "pdf", "mp4", "txt"][index % 5]}`,
  mimeType: "text/plain",
  fileSize: 2500000,
  usages: ["synthetic-block"],
  owned: true,
}));
const versions = Array.from({ length: 40 }, (_, index) => ({
  id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  pageId: "10000000-0000-4000-8000-000000000001",
  title: `Synthetic history ${index + 1}`,
  version: 40 - index,
  createdAt: new Date(
    Date.UTC(2026, 9, 30 - Math.floor(index / 24), index % 24),
  ).toISOString(),
  updatedAt: "2026-10-30T10:00:00Z",
  lastUpdatedBy: { name: "Synthetic editor" },
  content: {
    type: "doc",
    content: Array.from({ length: 35 }, (_, paragraph) => ({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `Version ${index + 1}, paragraph ${paragraph + 1}. ${"Synthetic document text. ".repeat(8)}`,
        },
      ],
    })),
  },
}));

async function fixture(
  kind,
  width,
  height = 850,
  theme = "light",
  reader = false,
) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  activePage = page;
  const errors = [];
  const navigationStarted = performance.now();
  const diagnostic = {
    kind,
    width,
    theme,
    reader,
    requests: [],
    pendingAtFailure: [],
    browserErrors: errors,
  };
  networkDiagnostics.push(diagnostic);
  const requestRecords = new Map();
  page.on("request", (request) => {
    const record = {
      method: request.method(),
      url: request.url(),
      startedMs: Math.round(performance.now() - navigationStarted),
    };
    requestRecords.set(request, record);
    diagnostic.requests.push(record);
  });
  page.on("response", (response) => {
    const record = requestRecords.get(response.request());
    if (record) record.status = response.status();
  });
  page.on("requestfinished", (request) => {
    const record = requestRecords.get(request);
    if (record) {
      record.finishedMs = Math.round(performance.now() - navigationStarted);
      record.durationMs = record.finishedMs - record.startedMs;
    }
  });
  page.on("requestfailed", (request) => {
    const record = requestRecords.get(request);
    if (record) {
      record.failedMs = Math.round(performance.now() - navigationStarted);
      record.durationMs = record.failedMs - record.startedMs;
      record.failure = request.failure()?.errorText;
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/actions/remove")) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "attachment_in_use" }),
      });
      return;
    }
    let data;
    if (/\/pages\/[^/]+\/attachments$/.test(url.pathname)) {
      const matching = files.filter((file) =>
        file.fileName.includes(url.searchParams.get("query") ?? ""),
      );
      const start = url.searchParams.has("cursor") ? 50 : 0;
      data = {
        items: matching.slice(start, start + 50),
        meta: { nextCursor: start + 50 < matching.length ? "second" : null },
        canDelete: !reader,
      };
    } else if (url.pathname === "/api/pages/history/info") {
      data = versions.find(
        (version) => version.id === url.searchParams.get("historyId"),
      );
    } else if (url.pathname === "/api/pages/history") {
      data = { items: versions, meta: {} };
    } else if (url.pathname.includes("/backlinks")) {
      data = { items: [], incoming: 123456, outgoing: 987654 };
    } else if (url.pathname.includes("/provenance")) {
      data = { createdFromTemplate: false };
    } else if (url.pathname.includes("/capabilities")) {
      data = { capabilities: { enabled: false } };
    } else if (
      url.pathname.includes("/ai/") ||
      url.pathname.endsWith("/status")
    ) {
      data = { enabled: false };
    } else {
      data = { items: [] };
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, status: 200, data }),
    });
  });
  try {
    await page.goto(
      `http://127.0.0.1:5209/e2e/header-panels/fixture.html?kind=${kind}&theme=${theme}${reader ? "&reader=1" : ""}`,
    );
    diagnostic.navigationMs = Math.round(performance.now() - navigationStarted);
  } catch (error) {
    diagnostic.navigationMs = Math.round(performance.now() - navigationStarted);
    diagnostic.pendingAtFailure = diagnostic.requests
      .filter(
        (request) =>
          request.finishedMs === undefined && request.failedMs === undefined,
      )
      .map((request) => ({
        ...request,
        pendingForMs: diagnostic.navigationMs - request.startedMs,
      }));
    diagnostic.documentState = await page
      .evaluate(() => ({
        readyState: document.readyState,
        title: document.title,
        bodyTextLength: document.body?.innerText.length,
        scriptCount: document.scripts.length,
      }))
      .catch(() => null);
    console.error(
      `PENDING header navigation: ${JSON.stringify(diagnostic.pendingAtFailure)}`,
    );
    throw error;
  }
  return { page, context, errors };
}

async function record(name, run) {
  await run();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}

async function openDetails(page) {
  await expect(page.locator('[data-page-header-action="menu"]')).toBeVisible();
  const direct = page.locator('[data-page-header-action="details"]');
  if (await direct.isVisible()) await direct.click();
  else {
    await page.locator('[data-page-header-action="menu"]').click();
    await page.locator('[data-page-header-menu-action="details"]').click();
  }
  return page.getByRole("dialog", { name: "Page details", exact: true });
}

try {
  await mkdir(output, { recursive: true });
  await server.listen();
  await server.warmupRequest("/e2e/header-panels/fixture.tsx");
  await server.waitForRequestsIdle();
  preparation.durationMs = Math.round(performance.now() - preparationStarted);
  preparation.staticImportsReady = true;
  console.log(
    `READY header panels static imports: ${preparation.durationMs}ms (cold cache: ${coldCache})`,
  );
  browser = await chromium.launch({ headless: true });
  if (setupOnly) {
    const { context } = await fixture("page", 1440);
    results.push({
      name: "setup-only-navigation",
      diagnosticOnly: true,
      passed: true,
    });
    await context.close();
  }
  for (const kind of setupOnly ? [] : ["page", "database"]) {
    for (const width of ["all", "export"].includes(scope) ? [390, 1440] : []) {
      for (const input of ["mouse", "keyboard"]) {
        await record(`${kind} export ${width} ${input}`, async () => {
          const { page, context, errors } = await fixture(kind, width);
          const trigger = page.locator('[data-page-header-action="menu"]');
          if (input === "keyboard") {
            await trigger.focus();
            await page.keyboard.press("Enter");
          } else await trigger.click();
          const item = page.getByRole("menuitem", {
            name: "Export",
            exact: true,
          });
          if (input === "keyboard") {
            await item.focus();
            await page.keyboard.press("Enter");
          } else await item.click();
          const dialog = page.getByRole("dialog", {
            name: kind === "database" ? "Export database" : "Export page",
            exact: true,
          });
          await expect(
            dialog.getByRole("textbox", { name: "Select export format" }),
          ).toBeFocused();
          // Keep real transitions enabled: delayed menu focus must not escape the dialog.
          await page.waitForTimeout(350);
          assert(
            await dialog.evaluate((node) =>
              node.contains(document.activeElement),
            ),
          );
          for (const key of [
            "Tab",
            "Shift+Tab",
            "Shift+Tab",
            "Tab",
            "Tab",
            "Tab",
            "Tab",
            "Tab",
          ]) {
            await page.keyboard.press(key);
            assert(
              await dialog.evaluate((node) =>
                node.contains(document.activeElement),
              ),
            );
          }
          await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
          await expect(trigger).toBeFocused();
          await trigger.click();
          await page
            .getByRole("menuitem", { name: "Copy link", exact: true })
            .or(
              page.getByRole("menuitem", {
                name: "Copy database link",
                exact: true,
              }),
            )
            .click();
          await expect(trigger).toBeFocused();
          // A route change during exit must cancel the old pending modal.
          await trigger.click();
          await item.click();
          await page
            .locator("[data-change-page]")
            .evaluate((node) => node.click());
          await page.waitForTimeout(350);
          await expect(
            page.getByRole("dialog", { name: /Export (page|database)/ }),
          ).toHaveCount(0);
          // Reopening the menu during its exit also invalidates its previous handoff.
          await trigger.click();
          await item.click();
          await trigger.click();
          await page.waitForTimeout(350);
          await expect(
            page.getByRole("dialog", { name: /Export (page|database)/ }),
          ).toHaveCount(0);
          await page.keyboard.press("Escape");
          await expect(trigger).toBeFocused();
          // Unmounting an owner during handoff must invalidate its old transition.
          await trigger.click();
          await item.click();
          const toggle = page.locator("[data-toggle-header]");
          await toggle.evaluate((node) => {
            node.focus();
            node.click();
          });
          await page.waitForTimeout(350);
          await expect(
            page.getByRole("dialog", { name: /Export (page|database)/ }),
          ).toHaveCount(0);
          await expect(toggle).toBeFocused();
          await toggle.click();
          await trigger.click();
          await item.click();
          await expect(
            dialog.getByRole("textbox", { name: "Select export format" }),
          ).toBeFocused();
          await page.keyboard.press("Escape");
          await expect(trigger).toBeFocused();
          assert.deepEqual(errors, []);
          await context.close();
        });
      }
    }
    for (const theme of ["all", "details"].includes(scope)
      ? ["light", "dark"]
      : []) {
      await record(`${kind} details responsive state ${theme}`, async () => {
        const { page, context, errors } = await fixture(kind, 1440, 900, theme);
        const dialog = await openDetails(page);
        const attachments = dialog.getByRole("tab", {
          name: "Attachments",
          exact: true,
        });
        await attachments.click();
        const search = dialog.getByRole("textbox", {
          name: "Search",
          exact: true,
        });
        const filtered = page.waitForResponse((response) =>
          response.url().includes("query=sample"),
        );
        await search.fill("sample");
        await expect(dialog.locator("tbody tr")).toHaveCount(50);
        await filtered;
        await dialog
          .getByRole("button", { name: "Load more", exact: true })
          .click();
        await expect(dialog.locator("tbody tr")).toHaveCount(60);
        await attachments.focus();
        for (const nextWidth of [390, 320, 1024, 1440]) {
          await page.setViewportSize({ width: nextWidth, height: 900 });
          await expect(dialog).toBeVisible();
          await expect(search).toHaveValue("sample");
          await expect(attachments).toHaveAttribute("aria-selected", "true");
          await expect(attachments).toBeFocused();
          await expect(dialog.locator("tbody tr")).toHaveCount(60);
          await expect(
            page.locator(".mantine-Modal-overlay:visible"),
          ).toHaveCount(1);
          const geometry = await dialog.evaluate((node) => {
            const tabs = [...node.querySelectorAll('[role="tab"]')].map(
              (tab) => {
                const box = tab.getBoundingClientRect();
                return {
                  left: box.left,
                  right: box.right,
                  top: box.top,
                  bottom: box.bottom,
                };
              },
            );
            const rect = node.getBoundingClientRect();
            return {
              width: node.clientWidth,
              scrollWidth: node.scrollWidth,
              left: rect.left,
              right: rect.right,
              tabs,
              overflow: [...node.querySelectorAll("*")]
                .flatMap((child) => {
                  const box = child.getBoundingClientRect();
                  return box.width && box.right > rect.right + 1
                    ? [
                        {
                          tag: child.tagName,
                          class: child.className,
                          right: box.right,
                          width: box.width,
                          text: child.textContent?.slice(0, 80),
                        },
                      ]
                    : [];
                })
                .slice(0, 12),
            };
          });
          assert(
            geometry.scrollWidth <= geometry.width + 1,
            JSON.stringify(geometry),
          );
          for (const tab of geometry.tabs)
            assert(tab.left >= geometry.left && tab.right <= geometry.right);
          if (nextWidth <= 390) {
            assert.equal(geometry.tabs[0].top, geometry.tabs[1].top);
            assert.equal(geometry.tabs[2].top, geometry.tabs[3].top);
            assert(geometry.tabs[2].top >= geometry.tabs[0].bottom);
          }
          await page.screenshot({
            path: path.join(
              output,
              `${kind}-details-${nextWidth}-${theme}.png`,
            ),
            fullPage: true,
          });
        }
        await attachments.focus();
        await page.keyboard.press("End");
        await expect(
          dialog.getByRole("tab", { name: /Outgoing/ }),
        ).toBeFocused();
        await page.keyboard.press("Home");
        await expect(
          dialog.getByRole("tab", { name: "Overview", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("ArrowRight");
        await expect(attachments).toBeFocused();
        await expect(search).toHaveValue("sample");
        const firstFile = dialog.locator("tbody tr").first();
        await firstFile.getByRole("button").first().click();
        const preview = page.getByRole("dialog", {
          name: files[0].fileName,
          exact: true,
        });
        await expect(preview).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(preview).toBeHidden();
        await expect(dialog).toBeVisible();
        await expect(search).toHaveValue("sample");
        await firstFile
          .getByRole("button", { name: "Delete", exact: true })
          .click();
        const deletion = page.getByRole("dialog", {
          name: "Delete",
          exact: true,
        });
        await deletion
          .getByRole("button", { name: "Delete", exact: true })
          .click();
        await expect(deletion).toBeHidden();
        await expect(dialog.getByRole("alert")).toBeVisible();
        await expect(dialog.locator("tbody tr")).toHaveCount(60);
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await expect(
          page.locator('[data-page-header-action="details"]'),
        ).toBeFocused();
        await openDetails(page);
        await expect(search).toHaveValue("sample");
        await expect(dialog.locator("tbody tr")).toHaveCount(60);
        await page
          .locator("[data-change-page]")
          .evaluate((node) => node.click());
        await expect(dialog).toBeHidden();
        await openDetails(page);
        await expect(
          dialog.getByRole("tab", { name: "Overview", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await dialog
          .getByRole("tab", { name: "Attachments", exact: true })
          .click();
        await expect(search).toHaveValue("");
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
    for (const theme of ["all", "reader"].includes(scope)
      ? ["light", "dark"]
      : []) {
      for (const width of [320, 390, 1440]) {
        await record(`${kind} reader panels ${width} ${theme}`, async () => {
          const { page, context, errors } = await fixture(
            kind,
            width,
            900,
            theme,
            true,
          );
          const dialog = await openDetails(page);
          const attachments = dialog.getByRole("tab", {
            name: "Attachments",
            exact: true,
          });
          await attachments.click();
          await expect(dialog.locator("tbody tr")).toHaveCount(50);
          await expect(
            dialog.getByRole("button", { name: "Delete", exact: true }),
          ).toHaveCount(0);
          const geometry = await dialog.evaluate((node) => ({
            client: node.clientWidth,
            scroll: node.scrollWidth,
          }));
          assert(
            geometry.scroll <= geometry.client + 1,
            JSON.stringify(geometry),
          );
          const firstFile = dialog.locator("tbody tr").first();
          await expect(firstFile.locator("td").nth(1)).toHaveText("WAV");
          const sizeLines = await firstFile
            .locator("td")
            .nth(2)
            .locator("span")
            .evaluate((node) => {
              const range = document.createRange();
              range.selectNodeContents(node);
              return range.getClientRects().length;
            });
          assert.equal(sizeLines, 1);
          await firstFile.getByRole("button").first().click();
          const preview = page.getByRole("dialog", {
            name: files[0].fileName,
            exact: true,
          });
          await expect(preview).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(preview).toBeHidden();
          await expect(dialog).toBeVisible();
          await dialog
            .getByRole("button", { name: "Close", exact: true })
            .click();
          await expect(
            width <= 390
              ? page.locator('[data-page-header-action="menu"]')
              : page.locator('[data-page-header-action="details"]'),
          ).toBeFocused();
          await page.locator("[data-open-history]").click();
          const history = page.getByRole("dialog", {
            name: "Page history",
            exact: true,
          });
          await expect(history).toBeVisible();
          await expect(
            history.getByRole("button", { name: "Restore", exact: true }),
          ).toHaveCount(0);
          await expect(
            history.getByRole("button", {
              name: "Delete version",
              exact: true,
            }),
          ).toHaveCount(0);
          await page.keyboard.press("Escape");
          await expect(history).toBeHidden();
          assert.deepEqual(errors, []);
          await context.close();
        });
      }
    }
  }
  for (const theme of !setupOnly && ["all", "history"].includes(scope)
    ? ["light", "dark"]
    : []) {
    for (const [width, height] of [
      [1024, 768],
      [1440, 600],
    ]) {
      await record(`history bounded ${width}x${height} ${theme}`, async () => {
        const { page, context, errors } = await fixture(
          "page",
          width,
          height,
          theme,
        );
        await page.locator("[data-open-history]").click();
        const dialog = page.getByRole("dialog", {
          name: "Page history",
          exact: true,
        });
        await expect(dialog).toHaveCSS("opacity", "1");
        const restore = dialog.getByRole("button", {
          name: "Restore",
          exact: true,
        });
        await expect(restore).toBeVisible();
        await expect(
          dialog.locator(".ProseMirror[contenteditable]"),
        ).toBeVisible();
        const geometry = await dialog.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const restore = [...node.querySelectorAll("button")]
            .find((button) => button.textContent === "Restore")
            .getBoundingClientRect();
          const scrolls = [
            ...node.querySelectorAll(".mantine-ScrollArea-viewport"),
          ].map((viewport) => ({
            height: viewport.clientHeight,
            scrollHeight: viewport.scrollHeight,
            bottom: viewport.getBoundingClientRect().bottom,
          }));
          const diffTop = node
            .querySelector(".mantine-Switch-root")
            ?.closest(".mantine-Paper-root")
            ?.getBoundingClientRect().top;
          return {
            top: rect.top,
            bottom: rect.bottom,
            restoreBottom: restore.bottom,
            viewport: innerHeight,
            scrolls,
            diffTop,
          };
        });
        assert(
          geometry.top >= -1 && geometry.bottom <= geometry.viewport + 1,
          JSON.stringify(geometry),
        );
        assert(
          geometry.restoreBottom <= geometry.bottom,
          JSON.stringify(geometry),
        );
        assert.equal(geometry.scrolls.length, 2);
        assert(
          geometry.diffTop !== undefined &&
            geometry.scrolls[1].bottom <= geometry.diffTop + 1,
          JSON.stringify(geometry),
        );
        for (const scroll of geometry.scrolls)
          assert(
            scroll.height > 0 && scroll.scrollHeight > scroll.height,
            JSON.stringify(geometry),
          );
        const viewports = dialog.locator(".mantine-ScrollArea-viewport");
        await viewports.nth(0).evaluate((node) => {
          node.scrollTop = 100;
        });
        assert.equal(
          await viewports.nth(1).evaluate((node) => node.scrollTop),
          0,
        );
        await restore.focus();
        await expect(restore).toBeInViewport();
        await restore.click();
        const confirmation = page.getByRole("dialog", {
          name: "Please confirm your action",
          exact: true,
        });
        await expect(confirmation).toBeVisible();
        await confirmation
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await expect(confirmation).toBeHidden();
        await expect(dialog).toBeVisible();
        await page.screenshot({
          path: path.join(output, `history-${width}x${height}-${theme}.png`),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
  }
  for (const width of !setupOnly && ["all", "preferences"].includes(scope)
    ? [320, 390, 1024, 1440]
    : []) {
    await record(`preferences responsive ${width}`, async () => {
      const { page, context, errors } = await fixture("preferences", width);
      await expect(
        page.getByRole("textbox", { name: "Select language" }),
      ).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(
        dimensions.scroll <= dimensions.client,
        JSON.stringify(dimensions),
      );
      for (const label of ["Select language", "Select theme"]) {
        const select = page.getByRole("textbox", { name: label });
        await select.focus();
        await page.keyboard.press("ArrowDown");
        await expect(page.getByRole("listbox")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(select).toBeFocused();
      }
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
} catch (error) {
  results.push({ passed: false, error: error.stack });
  if (activePage && !activePage.isClosed())
    await activePage
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  if (!preparation.staticImportsReady)
    preparation.durationMs = Math.round(performance.now() - preparationStarted);
  const sourceUnchanged =
    JSON.stringify(initialSources) === JSON.stringify(await sourceSnapshot());
  if (!sourceUnchanged) {
    results.push({
      passed: false,
      error: "A tested source changed during the run",
    });
    process.exitCode = 1;
  }
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        source: "working-tree",
        node: process.version,
        sourceFingerprints: initialSources,
        sourceUnchanged,
        browser: "chromium",
        transitions: "enabled",
        preparation,
        diagnosticOnly: setupOnly,
        networkDiagnostics,
        serverErrors,
        optimizerEvents,
        results,
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await server.close();
  console.log(`Evidence: ${output}`);
}
