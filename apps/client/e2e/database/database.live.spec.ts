import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

const fixture = JSON.parse(process.env.DATABASE_LIVE_FIXTURE!);
const sessions = JSON.parse(process.env.DATABASE_LIVE_SESSIONS!);
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
  await page.goto(fixture.route);
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
    page.getByRole("textbox", { name: "Name", exact: true }),
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
  await body.locator(":scope > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/Footnote");
  await page
    .locator("#slash-command")
    .getByRole("button", { name: /^Footnote/ })
    .click();
  const note = footer.getByRole("textbox", { name: "Footnote 3", exact: true });
  await expect(note).toBeVisible();
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
}) => {
  await open(page);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  const viewport = gridViewport(page);
  await viewport.evaluate((element) => {
    element.scrollTop = 2400;
  });
  const target = page
    .locator(`[data-database-cell-key$=":${notesId}"]`)
    .first();
  await expect
    .poll(() => target.getAttribute("data-database-cell-key"))
    .not.toBe(`${fixture.ids[100]}:${notesId}`);
  const key = await target.getAttribute("data-database-cell-key");
  const stable = page.locator(`[data-database-cell-key="${key}"]`);
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith("/cells"))
      writes++;
  });
  await stable.press("F2");
  await stable.getByRole("textbox").fill("Saved without jumping");
  const before = await viewport.evaluate((element) => element.scrollTop);
  await stable.getByRole("textbox").press("Tab");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
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
}) => {
  await open(page);
  const target = cell(page, 101);
  await target.press("F2");
  const editor = target.getByRole("textbox");
  await editor.fill("Preserved after network failure");
  await page.route(
    "**/cells",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      }),
    { times: 1 },
  );
  await editor.press("Tab");
  await expect(
    page.getByRole("status").filter({ hasText: "Failed to update data" }),
  ).toBeVisible();
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
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
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
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("First client");
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
    await other
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Second client");
    await other
      .getByRole("button", { name: "Save for everyone", exact: true })
      .click();
    await expect(
      other.getByText(
        "This view changed in another session. Your draft is preserved.",
      ),
    ).toBeVisible();
    await expect(
      other.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Second client");
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
  }) => {
    await open(page);
    await cell(page, 104)
      .locator("xpath=..")
      .getByRole("checkbox", { name: "Select row", exact: true })
      .check();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const started = Date.now();
    await page
      .getByRole("dialog", { name: "Delete", exact: true })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("treeitem", { name: "Second database", exact: true })
      .getByRole("link")
      .click();
    await expect(
      page.getByText("This database is empty", { exact: true }),
    ).toBeVisible();
    expect(Date.now() - started).toBeLessThan(5000);
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
