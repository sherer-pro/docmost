import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const scope =
  process.argv.find((arg) => arg.startsWith("--scope="))?.slice(8) ?? "all";
if (!["all", "author", "geometry"].includes(scope))
  throw new Error("Unknown search remediation scope");
const output = path.resolve(
  root,
  "../../artifacts/search-remediation",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const coldCache = process.argv.includes("--cold-cache");
const cacheDir = coldCache
  ? path.join(output, "vite-cache")
  : path.resolve(root, "../../artifacts/search-remediation/vite-cache");
const sources = [
  "src/features/search/components/search-spotlight.tsx",
  "src/features/search/components/advanced-search-controls.tsx",
  "src/features/search/components/search-spotlight-filters.tsx",
  "src/features/search/components/search-spotlight-filters.module.css",
  "src/features/search/components/search-result-item.tsx",
  "src/features/search/components/search-result-item.module.css",
  "src/features/search/components/dictionary-search-result-item.tsx",
  "src/features/search/hooks/use-unified-search.ts",
  "src/features/search/queries/search-query.ts",
  "src/features/search/services/search-service.ts",
  "public/locales/en-US/translation.json",
  "e2e/search-remediation/fixture.tsx",
  "e2e/search-remediation/run.mjs",
];
const snapshot = async () =>
  Object.fromEntries(
    await Promise.all(
      sources.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
const initialSources = await snapshot();
process.chdir(root);
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
    entries: ["e2e/search-remediation/fixture.html"],
    include: ["@mantine/modals", "react-helmet-async"],
  },
  server: { host: "127.0.0.1", port: 5211, strictPort: true, watch: null },
});
const results = [];
const optimizerEvents = [];
const serverErrors = [];
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
const requests = [];
const browserNavigations = [];
const space = {
  id: "20000000-0000-4000-8000-000000000001",
  slug: "synthetic",
  name: "Synthetic space",
};
const author = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Ada Lovelace",
};
const recoveredAuthor = {
  id: "30000000-0000-4000-8000-000000000002",
  name: "Error Recovery",
};
const long = `Needle${"LongUnbrokenSearchToken".repeat(16)}`;
const pages = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    slugId: "synthetic01",
    contentKind: "databaseRow",
    title: long,
    icon: "",
    space,
    highlight: `<mark>Needle</mark>${long}`,
    tagSnippets: [],
    databaseMatches: [
      {
        propertyId: "40000000-0000-4000-8000-000000000001",
        propertyName: long,
        text: long,
        matches: [],
      },
    ],
    labels: [{ id: "label", name: long }],
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    slugId: "synthetic02",
    contentKind: "page",
    title: "Needle tagged document",
    icon: "",
    space,
    highlight: "",
    tagMatchCount: 1,
    tagSnippets: [
      {
        text: long,
        matches: [{ start: 0, end: 6, value: "todo" }],
        anchorId: "synthetic-block",
      },
    ],
  },
];
const attachments = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    fileName: `${long}.pdf`,
    space,
    page: { id: pages[0].id, slugId: pages[0].slugId, title: long },
    highlight: `<mark>Needle</mark>${long}`,
  },
];
const dictionary = [
  {
    id: "60000000-0000-4000-8000-000000000001",
    term: long,
    matchedField: "definition",
    snippet: { text: long, matches: [] },
    definitionSnippet: { text: long, matches: [] },
    space,
  },
];
let browser;
let activePage;
let activeContext;

async function fixture(width, theme) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    locale: "en-US",
    reducedMotion: "no-preference",
  });
  activeContext = context;
  const page = await context.newPage();
  const navigationStarted = performance.now();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      browserNavigations.push({
        width,
        theme,
        elapsedMs: Math.round(performance.now() - navigationStarted),
        url: frame.url(),
      });
  });
  activePage = page;
  const errors = [];
  const authorRequests = [];
  const searchRequests = [];
  let releaseAuthor;
  let failedAuthor = false;
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : undefined;
    requests.push({
      width,
      theme,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    });
    let data;
    if (url.pathname === "/api/search/suggest") {
      const query = url.searchParams.get("query");
      authorRequests.push(Object.fromEntries(url.searchParams));
      if (query === "Ada")
        await new Promise((resolve) => {
          releaseAuthor = resolve;
        });
      if (query === "Error" && !failedAuthor) {
        failedAuthor = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Synthetic temporary failure" }),
        });
        return;
      }
      data = {
        users:
          query === "Nobody"
            ? []
            : [query === "Error" ? recoveredAuthor : author],
      };
    } else if (url.pathname === "/api/spaces")
      data = { items: [space], meta: {} };
    else if (
      url.pathname === "/api/search" ||
      url.pathname === "/api/search/attachments" ||
      url.pathname === "/api/search/dictionary"
    ) {
      searchRequests.push({ path: url.pathname, body });
      data = {
        items: url.pathname.endsWith("/attachments")
          ? attachments
          : url.pathname.endsWith("/dictionary")
            ? dictionary
            : pages,
      };
    } else data = { items: [] };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, status: 200, data }),
    });
  });
  await page.goto(
    `http://127.0.0.1:5211/e2e/search-remediation/fixture.html?theme=${theme}`,
  );
  await page
    .getByRole("button", { name: "Open search fixture", exact: true })
    .click();
  const dialog = page.locator(".mantine-Spotlight-content");
  await expect(dialog).toBeVisible();
  return {
    page,
    dialog,
    errors,
    authorRequests,
    searchRequests,
    releaseAuthor: () => releaseAuthor?.(),
  };
}

async function record(name, test) {
  try {
    await test();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.stack });
    if (activePage && !activePage.isClosed())
      await activePage
        .screenshot({
          path: path.join(
            output,
            `failure-${name.replace(/[^a-z0-9-]/gi, "-")}.png`,
          ),
          fullPage: true,
        })
        .catch(() => {});
    console.error(`FAIL ${name}: ${error.stack}`);
    process.exitCode = 1;
  } finally {
    await activeContext?.close();
    activeContext = undefined;
    activePage = undefined;
  }
}

async function documents(dialog, page) {
  await dialog.getByRole("button", { name: "Type: All", exact: true }).click();
  await page.getByRole("menuitem", { name: "Documents", exact: true }).click();
  const authorInput = dialog.getByRole("textbox", {
    name: "Author",
    exact: true,
  });
  await expect(authorInput).toBeVisible();
  return authorInput;
}

try {
  await mkdir(output, { recursive: true });
  await server.listen();
  await server.warmupRequest("/e2e/search-remediation/fixture.tsx");
  await server.waitForRequestsIdle();
  preparation.durationMs = Math.round(performance.now() - preparationStarted);
  preparation.staticImportsReady = true;
  console.log(
    `READY search static imports: ${preparation.durationMs}ms (cold cache: ${coldCache})`,
  );
  browser = await chromium.launch({ headless: true });
  for (const theme of ["light", "dark"]) {
    if (scope !== "geometry")
      await record(`author-states-${theme}`, async () => {
        const {
          page,
          dialog,
          errors,
          authorRequests,
          searchRequests,
          releaseAuthor,
        } = await fixture(1440, theme);
        const input = await documents(dialog, page);
        await input.click();
        await expect(
          page.getByText("Type a name to search for authors.", { exact: true }),
        ).toBeVisible();
        await page.waitForTimeout(350);
        assert.equal(authorRequests.length, 0);
        await input.fill("   ");
        await page.waitForTimeout(350);
        assert.equal(authorRequests.length, 0);
        await expect(page.getByRole("status")).toHaveCount(0);
        await input.fill("  Ada  ");
        await expect.poll(() => authorRequests.length).toBe(1);
        assert.equal(authorRequests[0].query, "Ada");
        assert.equal(authorRequests[0].includeUsers, "true");
        assert.equal(authorRequests[0].spaceId, space.id);
        await expect(
          page.getByText("Loading...", { exact: true }),
        ).toBeVisible();
        releaseAuthor();
        await page
          .getByRole("option", { name: author.name, exact: true })
          .click();
        await expect(input).toHaveValue(author.name);
        await expect
          .poll(() =>
            searchRequests.some(
              (request) => request.body.creatorId === author.id,
            ),
          )
          .toBe(true);
        await input.fill("Nobody");
        await expect(
          page.getByText("No results", { exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await input.blur();
        await expect(input).toHaveValue(author.name);
        const countBeforeClear = authorRequests.length;
        await input
          .locator(
            "xpath=ancestor::div[contains(@class,'mantine-Select-root')]",
          )
          .locator("button")
          .click();
        await expect(input).toHaveValue("");
        await page.waitForTimeout(350);
        assert(
          authorRequests
            .slice(countBeforeClear)
            .every((request) => request.query.trim().length > 0),
        );
        await input.fill("Error");
        await expect(dialog.getByRole("status")).toHaveText(
          "An error occurred",
        );
        await page.screenshot({
          path: path.join(output, `author-error-${theme}.png`),
          fullPage: true,
        });
        const retry = dialog.getByRole("button", {
          name: "Retry",
          exact: true,
        });
        await expect(retry).toBeVisible();
        if (theme === "dark") {
          await page.keyboard.press("Tab");
          await expect(
            dialog.getByRole("checkbox", {
              name: "Search titles only",
              exact: true,
            }),
          ).toBeFocused();
          await page.keyboard.press("Tab");
          await expect(retry).toBeFocused();
          await page.keyboard.press("Enter");
        } else await retry.click();
        await expect
          .poll(
            () =>
              authorRequests.filter((request) => request.query === "Error")
                .length,
          )
          .toBe(2);
        await input.click();
        await page
          .getByRole("option", { name: recoveredAuthor.name, exact: true })
          .click();
        await expect(input).toHaveValue(recoveredAuthor.name);
        assert.equal(
          authorRequests.filter((request) => request.query === "Error").length,
          2,
        );
        assert(
          authorRequests.every(
            (request) =>
              request.query && request.query === request.query.trim(),
          ),
        );
        assert.deepEqual(errors, []);
      });
    for (const width of scope === "author" ? [] : [320, 390, 1440]) {
      await record(`geometry-${width}-${theme}`, async () => {
        const { page, dialog, errors, searchRequests } = await fixture(
          width,
          theme,
        );
        await dialog
          .getByPlaceholder("Search...", { exact: true })
          .fill("Needle");
        const showAll = dialog.getByRole("button", {
          name: "Show all",
          exact: true,
        });
        await expect(showAll).toHaveCount(3);
        await expect(
          dialog
            .locator("section")
            .nth(2)
            .getByText(long, { exact: true })
            .first(),
        ).toBeVisible();
        for (let index = 0; index < 3; index++) {
          await showAll.nth(index).focus();
          await expect(showAll.nth(index)).toBeFocused();
          const geometry = await showAll.nth(index).evaluate((button) => {
            const rect = button.getBoundingClientRect();
            const modal = button.closest('[role="dialog"]');
            const bounds = modal.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              modalLeft: bounds.left,
              modalRight: bounds.right,
              client: modal.clientWidth,
              scroll: modal.scrollWidth,
            };
          });
          assert(
            geometry.left >= geometry.modalLeft + 2 &&
              geometry.right <= geometry.modalRight - 2,
            JSON.stringify(geometry),
          );
          assert(
            geometry.scroll <= geometry.client + 1,
            JSON.stringify(geometry),
          );
        }
        await page.screenshot({
          path: path.join(output, `all-results-${width}-${theme}.png`),
          fullPage: true,
        });
        await showAll.first().focus();
        await page.keyboard.press("Enter");
        const authorInput = dialog.getByRole("textbox", {
          name: "Author",
          exact: true,
        });
        const titleOnly = dialog.getByRole("checkbox", {
          name: "Search titles only",
          exact: true,
        });
        await expect(authorInput).toBeVisible();
        await expect(titleOnly).toBeVisible();
        await titleOnly.check();
        await expect
          .poll(() =>
            searchRequests.some(
              (request) =>
                request.path === "/api/search" &&
                request.body.titleOnly === true,
            ),
          )
          .toBe(true);
        const geometry = await authorInput.evaluate((input) => {
          const rect = input.getBoundingClientRect();
          const modal = input
            .closest('[role="dialog"]')
            .getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            modalLeft: modal.left,
            modalRight: modal.right,
          };
        });
        assert(
          geometry.width <= 221 &&
            geometry.left >= geometry.modalLeft &&
            geometry.right <= geometry.modalRight,
          JSON.stringify(geometry),
        );
        await page.screenshot({
          path: path.join(output, `advanced-${width}-${theme}.png`),
          fullPage: true,
        });
        assert.deepEqual(errors, []);
      });
    }
  }
} finally {
  if (!preparation.staticImportsReady)
    preparation.durationMs = Math.round(performance.now() - preparationStarted);
  const sourceUnchanged =
    JSON.stringify(initialSources) === JSON.stringify(await snapshot());
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
        node: process.version,
        browser: "chromium",
        source: "working-tree",
        sourceFingerprints: initialSources,
        sourceUnchanged,
        preparation,
        optimizerEvents,
        serverErrors,
        browserNavigations,
        results,
        requests,
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await server.close();
  console.log(`Evidence: ${output}`);
}
